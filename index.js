const express = require('express');
const puppeteer = require('puppeteer');

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());

// Deklarasikan variabel global untuk menyimpan instans browser
let browserInstance = null;
// Gunakan variabel global untuk menyimpan satu halaman yang bisa di-reuse
// Ini HANYA bisa dilakukan jika Anda YAKIN setiap request tidak akan berinterferensi.
// Untuk penggunaan umum, membuat page baru per request lebih aman.
// Namun, demi HEMAT MEMORI di tier free, kita bisa coba reuse.
// Jika ada masalah konkurensi, ini akan jadi penyebabnya.
let sharedPageInstance = null;

/**
 * Fungsi untuk meluncurkan browser Puppeteer.
 * Dipanggil sekali saat startup, dan jika browser terputus.
 */
async function launchBrowser() {
  if (browserInstance) {
    console.log('Browser instance already exists, skipping launch.');
    return;
  }

  try {
    console.log('Launching Puppeteer browser...');
    browserInstance = await puppeteer.launch({
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH, // Untuk lingkungan khusus
      headless: true, // WAJIB true untuk lingkungan server produksi
      args: [
        '--no-sandbox',                  // Penting untuk lingkungan kontainer (Render)
        '--disable-setuid-sandbox',      // Penting untuk lingkungan kontainer
        '--disable-dev-shm-usage',       // Mengurangi penggunaan memori di /dev/shm
        '--single-process',              // Mengurangi jejak memori dengan hanya satu proses Chrome
        '--disable-gpu',                 // Mengurangi penggunaan GPU yang mungkin tidak ada
        '--no-zygote',                   // Membantu dengan stabilitas di beberapa lingkungan
        '--disable-setuid-sandbox',      // Duplikasi tapi memastikan
        '--disable-extensions',          // Matikan ekstensi
        '--disable-features=site-per-process', // Mengurangi isolasi proses, hati-hati!
        '--incognito'                    // Mode incognito untuk memastikan sesi bersih
      ],
      // Menurunkan resolusi viewport default untuk menghemat memori
      defaultViewport: {
        width: 800,
        height: 600
      }
    });
    console.log('Puppeteer browser launched successfully.');

    // Inisialisasi sharedPageInstance sekali
    sharedPageInstance = await browserInstance.newPage();
    // Atur User Agent di halaman bersama
    await sharedPageInstance.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
    console.log('Shared page instance created.');

    // Tambahkan event listener untuk menangani disconnect (misalnya, browser crash)
    browserInstance.on('disconnected', () => {
      console.error('Puppeteer browser disconnected! Attempting to nullify instances and re-launch...');
      browserInstance = null; // Setel ke null agar bisa diluncurkan ulang
      sharedPageInstance = null; // Juga null-kan halaman bersama
    });

  } catch (error) {
    console.error('Failed to launch Puppeteer browser:', error);
    // Sangat penting: Keluar dari aplikasi jika browser tidak bisa diluncurkan saat startup
    // Agar Render atau platform lain tahu bahwa ada masalah serius
    process.exit(1);
  }
}

/**
 * Fungsi untuk melakukan scraping. Sekarang menggunakan sharedPageInstance.
 * @param {string} url - URL yang akan discrape.
 * @returns {Promise<string>} HTML konten dari halaman.
 */
async function scrapeUrl(url) {
  if (!sharedPageInstance) {
    throw new Error('Shared page instance is not available. Browser might have disconnected.');
  }

  try {
    console.log(`Navigating shared page to: ${url}`);
    // Timeout yang lebih rendah untuk navigasi
    const navigationTimeout = 30000; // 30 detik (kurangi dari 60 detik)

    // Gunakan 'domcontentloaded' untuk kecepatan. Ini lebih cepat karena tidak menunggu semua resource.
    // Jika Anda benar-benar membutuhkan semua resource, pertimbangkan 'load' atau 'networkidle0',
    // tetapi itu akan lebih lambat dan memakan lebih banyak memori.
    await sharedPageInstance.goto(url, { waitUntil: 'domcontentloaded', timeout: navigationTimeout });

    const htmlContent = await sharedPageInstance.content();
    console.log(`Successfully scraped content from: ${url}`);
    return htmlContent;

  } catch (error) {
    console.error(`Error scraping ${url}:`, error);
    throw error; // Lempar kembali error agar bisa ditangani di endpoint
  }
  // Tidak ada page.close() di sini karena kita me-reuse sharedPageInstance
}

// --- Inisialisasi Aplikasi ---

// Panggil fungsi untuk meluncurkan browser saat aplikasi dimulai
// Ini adalah inisialisasi awal. Jika gagal, aplikasi akan keluar.
(async () => {
  await launchBrowser();
  app.listen(port, () => {
    console.log(`Server listening at http://localhost:${port}`);
    console.log(`Scrape endpoint: http://localhost:${port}/scrape?url=https://example.com`);
  });
})();

// --- Endpoint ---

app.get('/scrape', async (req, res) => {
  const url = req.query.url;

  if (!url) {
    return res.status(400).json({ error: 'URL is required as a query parameter (e.g., /scrape?url=...).' });
  }

  // Cek kembali ketersediaan browserInstance/sharedPageInstance sebelum memulai scraping
  if (!browserInstance || !sharedPageInstance) {
    console.warn('Browser or shared page instance is null. Attempting re-launch before processing request.');
    try {
      await launchBrowser(); // Coba luncurkan ulang jika ada yang null
      if (!browserInstance || !sharedPageInstance) {
        throw new Error('Failed to re-launch browser and/or shared page instance.');
      }
    } catch (launchError) {
      console.error('Critical: Failed to re-launch browser for request:', launchError);
      return res.status(500).json({ error: 'Scraper service is temporarily unavailable. Browser failed to launch.', details: launchError.message });
    }
  }

  try {
    const htmlContent = await scrapeUrl(url);
    res.status(200).send(htmlContent);
  } catch (error) {
    console.error('Request processing error:', error);
    res.status(500).json({ error: 'Failed to scrape the URL.', details: error.message });
  }
});

app.get('/', (req, res) => {
  res.send('Puppeteer Scraper is running! Use /scrape?url=YOUR_URL_HERE to scrape.');
});

// --- Graceful Shutdown ---
// Pastikan browser ditutup dengan rapi saat aplikasi dimatikan.
process.on('SIGINT', async () => {
  console.log('Received SIGINT. Closing browser and shutting down...');
  if (browserInstance) {
    await browserInstance.close();
  }
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('Received SIGTERM. Closing browser and shutting down...');
  if (browserInstance) {
    await browserInstance.close();
  }
  process.exit(0);
});
