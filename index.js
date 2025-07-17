const express = require('express');
const puppeteer = require('puppeteer');

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());

app.post('/scrape', async (req, res) => {
    const { url } = req.body;

    if (!url) {
        return res.status(400).json({ error: 'URL is required in the request body.' });
    }

    let browser;
    try {
        browser = await puppeteer.launch({
            // Pastikan ini ada dan mengacu ke variabel lingkungan
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
            headless: true, // Pastikan ini true untuk lingkungan server
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--single-process'
            ]
        });
        const page = await browser.newPage();

        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');

        await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

        const htmlContent = await page.content();

        res.status(200).send(htmlContent);

    } catch (error) {
        console.error('Scraping error:', error);
        res.status(500).json({ error: 'Failed to scrape the URL.', details: error.message });
    } finally {
        if (browser) {
            await browser.close();
        }
    }
});

app.get('/', (req, res) => {
    res.send('Puppeteer Scraper is running!');
});

app.listen(port, () => {
    console.log(`Server listening at http://localhost:${port}`);
});
