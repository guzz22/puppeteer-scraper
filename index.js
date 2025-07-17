const express = require('express');
const puppeteer = require('puppeteer');

const app = express();
const port = process.env.PORT || 3000; // Gunakan port dari environment variable atau default ke 3000

app.use(express.json()); // Untuk mengurai body request dalam format JSON

// Endpoint utama untuk scraping
app.post('/scrape', async (req, res) => {
    const { url } = req.body;

    if (!url) {
        return res.status(400).json({ error: 'URL is required in the request body.' });
    }

    let browser;
    try {
        // Luncurkan browser Puppeteer
        // Menggunakan args ini penting untuk lingkungan tanpa GUI seperti Render
        browser = await puppeteer.launch({
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage', // Penting untuk mencegah masalah memori
                '--disable-accelerated-video-decode',
                '--disable-gpu',
                '--no-zygote',
                '--single-process' // Penting untuk mengurangi penggunaan sumber daya
            ]
        });
        const page = await browser.newPage();

        // Opsional: Atur user agent agar terlihat lebih seperti browser sungguhan
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');

        // Buka URL
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 }); // Tunggu sampai jaringan idle, timeout 60 detik

        // Tunggu beberapa saat lagi jika ada rendering JavaScript yang lambat (opsional)
        // await page.waitForTimeout(3000); // Tunggu 3 detik

        // Ambil konten HTML penuh dari halaman
        const htmlContent = await page.content();

        // Kirim HTML sebagai respons
        res.status(200).send(htmlContent);

    } catch (error) {
        console.error('Scraping error:', error);
        res.status(500).json({ error: 'Failed to scrape the URL.', details: error.message });
    } finally {
        // Pastikan browser ditutup meskipun ada error
        if (browser) {
            await browser.close();
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
