const express = require('express');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs').promises; // Untuk operasi file asinkron

puppeteer.use(StealthPlugin());

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());

let browserInstance = null;
const COOKIE_FILE = 'cloudflare_cookies.json'; // Lokasi penyimpanan cookie

// --- Fungsi Helper untuk Cookie ---
async function saveCookies(cookies) {
    try {
        await fs.writeFile(COOKIE_FILE, JSON.stringify(cookies, null, 2));
        console.log('Cookies saved successfully.');
    } catch (error) {
        console.error('Failed to save cookies:', error);
    }
}

async function loadCookies() {
    try {
        const data = await fs.readFile(COOKIE_FILE, 'utf8');
        console.log('Cookies loaded successfully.');
        return JSON.parse(data);
    } catch (error) {
        if (error.code === 'ENOENT') {
            console.warn('Cookie file not found. Starting with no cookies.');
        } else {
            console.error('Failed to load cookies:', error);
        }
        return [];
    }
}

// --- Fungsi untuk Meluncurkan Browser ---
async function launchBrowser() {
    if (browserInstance) {
        console.log('Browser instance already exists, skipping launch.');
        return;
    }

    try {
        console.log('Launching Puppeteer browser...');
        browserInstance = await puppeteer.launch({
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--single-process',
                '--disable-gpu',
                '--no-zygote'
            ]
        });
        console.log('Puppeteer browser launched successfully.');
        browserInstance.on('disconnected', () => {
            console.error('Puppeteer browser disconnected! Attempting to nullify instance...');
            browserInstance = null;
        });
    } catch (error) {
        console.error('Failed to launch Puppeteer browser:', error);
        process.exit(1);
    }
}

// --- Fungsi untuk Mengambil Cookie Baru dari Cloudflare ---
async function getNewCloudflareCookies(url) {
    console.log(`Attempting to get new Cloudflare cookies for ${url}...`);
    let page;
    try {
        page = await browserInstance.newPage();
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });

        // Tunggu hingga Cloudflare selesai (misalnya, menunggu body atau selector utama muncul)
        // GANTI 'body' dengan selector yang lebih spesifik jika Anda tahu
        console.log('Waiting for Cloudflare challenge to resolve (getNewCookies)...');
        try {
            await page.waitForSelector('body', { timeout: 15000 }); // Tunggu hingga body ada, atau ganti dengan selector konten utama
            // Atau jika Anda tahu ada elemen anti-bot tertentu yang hilang:
            // await page.waitForFunction(() => !document.querySelector('.cf-challenge'), { timeout: 15000 });
            console.log('Cloudflare resolved, extracting cookies.');
        } catch (selectorError) {
            console.warn('Timed out waiting for main selector/Cloudflare to resolve. May not have new cookies.', selectorError);
        }

        const cookies = await page.cookies();
        await saveCookies(cookies); // Simpan cookies yang baru
        console.log('New Cloudflare cookies obtained and saved.');
        return cookies;
    } catch (error) {
        console.error('Error getting new Cloudflare cookies:', error);
        throw error;
    } finally {
        if (page) await page.close();
    }
}


// --- Fungsi Scrape yang Diperbarui ---
async function scrapeUrlWithNewPage(url, useCachedCookies = true) {
    let page;
    let currentCookies = [];
    let shouldUpdateCookies = false; // Flag untuk tahu apakah perlu update cookie setelah scrape ini

    try {
        if (!browserInstance) {
            console.warn('Browser instance is null. Re-launching...');
            await launchBrowser();
            if (!browserInstance) throw new Error('Browser could not be launched.');
        }

        page = await browserInstance.newPage();
        console.log(`Created new page for: ${url}`);

        if (useCachedCookies) {
            currentCookies = await loadCookies();
            if (currentCookies && currentCookies.length > 0) {
                await page.setCookie(...currentCookies);
                console.log('Using cached cookies for navigation.');
            } else {
                console.log('No cached cookies found or loaded. Will try to get new ones.');
                shouldUpdateCookies = true; // Akan mencoba mendapatkan cookie baru setelah navigasi
            }
        } else {
            // Ini dipanggil saat force update cookies
            console.log('Forcing new cookie acquisition.');
            shouldUpdateCookies = true;
        }

        const navigationTimeout = 60000;

        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: navigationTimeout });

        // --- Cek Apakah Cloudflare Muncul Setelah Navigasi ---
        // Periksa apakah halaman masih menunjukkan tanda-tanda Cloudflare
        const isCloudflareChallenge = await page.evaluate(() => {
            // Contoh: Cari elemen yang sering muncul di halaman Cloudflare challenge
            const challengeText = document.body.innerText;
            return challengeText.includes('Checking your browser') ||
                   challengeText.includes('Verify you are human') ||
                   document.querySelector('#cf-wrapper') ||
                   document.querySelector('#challenge-form');
        });

        if (isCloudflareChallenge) {
            console.warn('Cloudflare challenge detected after navigation with cached cookies. Attempting to get new cookies...');
            shouldUpdateCookies = true; // Set flag untuk update cookie
            // Tunggu hingga Cloudflare benar-benar selesai
            try {
                // Di sini kita menunggu Cloudflare selesai jika itu muncul
                await page.waitForSelector('body', { timeout: 15000 }); // Tunggu 15 detik untuk Cloudflare
                console.log('Cloudflare resolved after re-challenge.');
                // Ambil cookies lagi setelah Cloudflare berhasil dilewati
                currentCookies = await page.cookies();
                await saveCookies(currentCookies); // Simpan cookies yang diperbarui
            } catch (error) {
                console.error('Timed out waiting for Cloudflare to resolve after re-challenge, might still be blocked.', error);
                throw new Error('Failed to resolve Cloudflare challenge after re-challenge.');
            }
        } else if (shouldUpdateCookies) {
            // Jika tidak ada Cloudflare challenge dan kita memulai tanpa cookie
            // Ambil dan simpan cookie yang baru (jika ada yang dihasilkan oleh navigasi awal)
            currentCookies = await page.cookies();
            await saveCookies(currentCookies);
            console.log('No Cloudflare challenge, but new cookies saved from initial navigation.');
        } else {
            console.log('Successfully navigated using cached cookies without re-challenge.');
        }

        const htmlContent = await page.content();
        console.log(`Successfully scraped content from: ${url}`);
        return htmlContent;

    } catch (error) {
        console.error(`Error scraping ${url}:`, error);
        if (page) {
            const errorPageContent = await page.content();
            console.error('Content of the page on error:', errorPageContent.substring(0, 500) + '...');
        }
        throw error;
    } finally {
        if (page) await page.close();
    }
}

// --- Endpoint ---
app.get('/scrape', async (req, res) => {
    const url = req.query.url;
    const forceNewCookies = req.query.forceNewCookies === 'true'; // Tambahkan parameter untuk force update

    if (!url) {
        return res.status(400).json({ error: 'URL is required.' });
    }

    if (!browserInstance) {
        console.warn('Browser instance is null, re-attempting launch.');
        try {
            await launchBrowser();
            if (!browserInstance) throw new Error('Failed to re-launch browser instance.');
        } catch (launchError) {
            console.error('Critical: Failed to re-launch browser for request:', launchError);
            return res.status(500).json({ error: 'Scraper service unavailable. Browser failed to launch.', details: launchError.message });
        }
    }

    try {
        let htmlContent;
        if (forceNewCookies) {
            console.log('Forcing new cookie acquisition...');
            await getNewCloudflareCookies(url); // Dapatkan dan simpan cookie baru
            htmlContent = await scrapeUrlWithNewPage(url, true); // Lalu scrape dengan cookie baru
        } else {
            htmlContent = await scrapeUrlWithNewPage(url, true);
        }
        res.status(200).send(htmlContent);
    } catch (error) {
        console.error('Request processing error:', error);
        res.status(500).json({ error: 'Failed to scrape the URL.', details: error.message });
    }
});

app.get('/', (req, res) => {
    res.send('Puppeteer Scraper is running! Use /scrape?url=YOUR_URL_HERE or /scrape?url=YOUR_URL_HERE&forceNewCookies=true.');
});

// --- Inisialisasi Aplikasi ---
(async () => {
    await launchBrowser();
    app.listen(port, () => {
        console.log(`Server listening at http://localhost:${port}`);
        console.log(`Scrape endpoint: http://localhost:${port}/scrape?url=https://example.com`);
        console.log(`Force new cookies: http://localhost:${port}/scrape?url=https://example.com&forceNewCookies=true`);
    });
})();

// --- Graceful Shutdown ---
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
