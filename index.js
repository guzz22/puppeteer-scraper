const express = require('express');
const puppeteer = require('puppeteer');

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json()); // Meskipun tidak lagi menerima JSON untuk /scrape, ini tetap bisa berguna untuk endpoint lain.

// Deklarasikan variabel global untuk menyimpan instans browser
let browserInstance = null;

// Fungsi untuk meluncurkan browser Puppeteer
async function launchBrowser() {
    try {
        console.log('Launching Puppeteer browser...');
        browserInstance = await puppeteer.launch({
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
            headless: true, // Pastikan ini true untuk lingkungan server
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--single-process'
            ]
        });
        console.log('Puppeteer browser launched successfully.');

        // Tambahkan event listener untuk menangani disconnect (misalnya, browser crash)
        browserInstance.on('disconnected', () => {
            console.error('Puppeteer browser disconnected! Re-launching...');
            browserInstance = null; // Setel ke null agar bisa diluncurkan ulang
        });

    } catch (error) {
        console.error('Failed to launch Puppeteer browser:', error);
        // Penting: Keluar dari aplikasi jika browser tidak bisa diluncurkan saat startup
        process.exit(1);
    }
}

// Panggil fungsi untuk meluncurkan browser saat aplikasi dimulai
launchBrowser();

// ---

// Endpoint utama untuk scraping, sekarang menggunakan GET
app.get('/scrape', async (req, res) => {
    // Mengambil URL dari query parameter (misal: /scrape?url=https://example.com)
    const url = req.query.url;

    if (!url) {
        return res.status(400).json({ error: 'URL is required as a query parameter (e.g., /scrape?url=...).' });
    }

    // Pastikan browser sudah siap. Jika belum, coba luncurkan ulang.
    if (!browserInstance) {
        console.warn('Browser instance not available, attempting to re-launch.');
        await launchBrowser(); // Coba luncurkan ulang jika disconnected
        if (!browserInstance) { // Jika masih gagal setelah mencoba, kirim error
            return res.status(500).json({ error: 'Browser not ready. Please try again.' });
        }
    }

    let page;
    try {
        // Gunakan instans browser yang sudah ada untuk membuat halaman baru
        page = await browserInstance.newPage();

        // Opsional: Atur user agent agar terlihat lebih seperti browser sungguhan
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');

        // Buka URL
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

        // Ambil konten HTML penuh dari halaman
        const htmlContent = await page.content();

        // Kirim HTML sebagai respons
        res.status(200).send(htmlContent);

    } catch (error) {
        console.error('Scraping error:', error);
        res.status(500).json({ error: 'Failed to scrape the URL.', details: error.message });
    } finally {
        // Pastikan halaman ditutup, bukan browsernya!
        if (page) {
            await page.close();
        }
    }
});

// Endpoint default untuk cek status (opsional)
app.get('/', (req, res) => {
    res.send('Puppeteer Scraper is running!');
});

app.listen(port, () => {
    console.log(`Server listening at http://localhost:${port}`);
});
