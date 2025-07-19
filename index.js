const express = require('express');
// Ganti ini:
// const puppeteer = require('puppeteer');
// Dengan ini:
const puppeteer = require('puppeteer-extra'); // Menggunakan puppeteer-extra
const StealthPlugin = require('puppeteer-extra-plugin-stealth'); // Import StealthPlugin

// Daftarkan plugin stealth sebelum meluncurkan browser
puppeteer.use(StealthPlugin());

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());

// Deklarasikan variabel global untuk menyimpan instans browser
let browserInstance = null;

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
      headless: true, // Pastikan ini true untuk lingkungan server produksi
      args: [
        '--no-sandbox',           // Penting untuk lingkungan kontainer (Render)
        '--disable-setuid-sandbox', // Penting untuk lingkungan kontainer
        '--disable-dev-shm-usage',  // Mengurangi penggunaan memori di /dev/shm
        '--single-process',       // Mengurangi jejak memori dengan hanya satu proses Chrome
        '--disable-gpu',          // Mengurangi penggunaan GPU yang mungkin tidak ada
        '--no-zygote'             // Membantu dengan stabilitas di beberapa lingkungan
      ]
    });
    console.log('Puppeteer browser launched successfully.');

    // Tambahkan event listener untuk menangani disconnect (misalnya, browser crash)
    browserInstance.on('disconnected', () => {
      console.error('Puppeteer browser disconnected! Attempting to nullify instance...');
      browserInstance = null; // Setel ke null agar bisa diluncurkan ulang saat permintaan berikutnya
      // Anda mungkin ingin menambahkan logika retry atau notifikasi di sini
    });

  } catch (error) {
    console.error('Failed to launch Puppeteer browser:', error);
    // Sangat penting: Keluar dari aplikasi jika browser tidak bisa diluncurkan saat startup
    // Agar Render atau platform lain tahu bahwa ada masalah serius
    process.exit(1);
  }
}

/**
 * Fungsi untuk mendapatkan halaman baru dari browser yang sudah ada.
 * Mengelola timeout untuk page.goto dan menutup halaman setelah selesai.
 * @param {string} url - URL yang akan discrape.
 * @returns {Promise<string>} HTML konten dari halaman.
 */
async function scrapeUrlWithNewPage(url) {
  let page;
  try {
    if (!browserInstance) {
      console.warn('Browser instance is null when trying to create a new page. Re-launching...');
      await launchBrowser();
      if (!browserInstance) {
        throw new Error('Browser could not be launched or re-launched.');
      }
    }

    page = await browserInstance.newPage();
    console.log(`Created new page for: ${url}`);

    // Dengan puppeteer-extra dan stealth plugin, Anda tidak perlu mengatur User-Agent secara manual
    // Plugin sudah menangani banyak aspek deteksi bot, termasuk user-agent.
    // Jika masih ada masalah, Anda bisa coba mengaturnya lagi, tapi biarkan stealth plugin bekerja dulu.
    // await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');

    // Timeout yang lebih rendah untuk navigasi jika page macet
    const navigationTimeout = 60000; // 60 detik

    // Coba tambahkan penundaan awal sebelum navigasi, kadang membantu Cloudflare "berpikir"
    // await page.waitForTimeout(1000); // Tambahkan jeda 1 detik

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: navigationTimeout });

    // --- PENTING: Tambahkan penundaan setelah navigasi untuk Cloudflare ---
    // Cloudflare sering membutuhkan waktu beberapa detik untuk melakukan pemeriksaan
    // dan menyelesaikan tantangan. Menunggu di sini bisa sangat membantu.
    console.log('Waiting for Cloudflare challenge to potentially resolve...');
    console.log('Waiting for potential Cloudflare challenge resolution (using setTimeout)...');
await new Promise(resolve => setTimeout(resolve, 8000)); // Menunggu 8 detik
    // Atau coba cari elemen yang muncul setelah Cloudflare terlewati, contoh:
    // await page.waitForSelector('body', { timeout: 15000 }); // Tunggu body muncul, atau elemen spesifik lain

    const htmlContent = await page.content();
    console.log(`Successfully scraped content from: ${url}`);
    return htmlContent;

  } catch (error) {
    console.error(`Error scraping ${url}:`, error);
    // Coba log konten jika ada error untuk debugging lebih lanjut
    if (page) {
      const errorPageContent = await page.content();
      console.error('Content of the page on error:', errorPageContent.substring(0, 500) + '...'); // Log 500 karakter pertama
    }
    throw error; // Lempar kembali error agar bisa ditangani di endpoint
  } finally {
    if (page) {
      await page.close(); // Selalu tutup halaman setelah selesai
      console.log('Page closed.');
    }
  }
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

  // Cek kembali ketersediaan browserInstance sebelum memulai scraping
  if (!browserInstance) {
    console.warn('Browser instance is null, re-attempting launch before processing request.');
    try {
      await launchBrowser(); // Coba luncurkan ulang jika browserInstance null
      if (!browserInstance) {
        throw new Error('Failed to re-launch browser instance.');
      }
    } catch (launchError) {
      console.error('Critical: Failed to re-launch browser for request:', launchError);
      return res.status(500).json({ error: 'Scraper service is temporarily unavailable. Browser failed to launch.', details: launchError.message });
    }
  }

  try {
    const htmlContent = await scrapeUrlWithNewPage(url);
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
