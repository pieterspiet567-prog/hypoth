const express = require("express");
const { chromium } = require("playwright");
const Tesseract = require('tesseract.js');
const fs = require('fs');

const app = express();
app.use(express.json());

const URL =
  "https://www.notaris.be/rekenmodules/wonen/berekening-van-de-kosten-voor-standaardkrediet";
const MAX_CONCURRENT_BROWSER_REQUESTS = 1;
const CACHE_TTL_MS = 5 * 60 * 1000;

let browser;
let activeBrowserRequests = 0;
const browserWaitQueue = [];
const resultCache = new Map();

function cleanAmount(value) {
  if (!value) return null;
  return value.replace(/\s+/g, " ").trim();
}

async function waitForBrowserSlot() {
  if (activeBrowserRequests < MAX_CONCURRENT_BROWSER_REQUESTS) {
    activeBrowserRequests += 1;
    return;
  }

  await new Promise((resolve) => browserWaitQueue.push(resolve));
  activeBrowserRequests += 1;
}

function releaseBrowserSlot() {
  activeBrowserRequests = Math.max(0, activeBrowserRequests - 1);
  if (browserWaitQueue.length > 0 && activeBrowserRequests < MAX_CONCURRENT_BROWSER_REQUESTS) {
    const next = browserWaitQueue.shift();
    next();
  }
}

function getCacheKey(kredietbedrag) {
  return `krediet:${kredietbedrag}`;
}

function getCachedResult(kredietbedrag) {
  const key = getCacheKey(kredietbedrag);
  const cached = resultCache.get(key);

  if (!cached) return null;

  if (Date.now() - cached.timestamp > CACHE_TTL_MS) {
    resultCache.delete(key);
    return null;
  }

  return cached.data;
}

function setCachedResult(kredietbedrag, data) {
  resultCache.set(getCacheKey(kredietbedrag), {
    timestamp: Date.now(),
    data
  });
}

async function getBrowser() {
  if (!browser) {
    const headless = process.env.HEADLESS === 'false' ? false : true;
    browser = await chromium.launch({
      headless,
      args: ["--no-sandbox", "--disable-setuid-sandbox"]
    });
  }

  return browser;
}

async function calculateNotarisKosten(kredietbedrag) {
  let page;
  let context;

  try {
    const browserInstance = await getBrowser();
    context = await browserInstance.newContext({ viewport: { width: 1650, height: 1000 } });
    page = await context.newPage();

    await page.goto(URL, { waitUntil: 'load', timeout: 60000 });

    try {
      await page.getByText('ALLE COOKIES TOESTAAN', { exact: false }).click({ timeout: 2000 });
    } catch {}

    // Probeer eerst specifieke, bekende selectors (sneller en betrouwbaarder)
    let usedPrimary = false;
    const candidateSelectors = ['#edit-text', 'input.form-text', 'input[name="text"]', 'input[type="text"]'];

    for (const sel of candidateSelectors) {
      try {
        const handle = await page.waitForSelector(sel, { timeout: 4000 });
        if (handle) {
          // vul via DOM-evaluate om ook met niet-standaard widgets te werken
          await page.evaluate((s, v) => {
            const el = document.querySelector(s);
            if (el) { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); }
          }, sel, String(kredietbedrag));

          // probeer ook tweede veld als aanwezig
          await page.evaluate((v) => {
            const inputs = Array.from(document.querySelectorAll('input'));
            if (inputs[1]) { inputs[1].value = v; inputs[1].dispatchEvent(new Event('input', { bubbles: true })); }
            if (inputs[2]) { inputs[2].value = Math.round(Number(v) * 0.1); inputs[2].dispatchEvent(new Event('input', { bubbles: true })); }
          }, String(kredietbedrag));

          // klik de bereken-knop
          try {
            await Promise.race([
              page.getByText('Bereken', { exact: false }).click({ timeout: 4000 }),
              page.getByRole('button', { name: /bereken/i }).click({ timeout: 4000 })
            ]);
          } catch {
            try { await page.mouse.click(165, 697); } catch {}
          }

          await page.waitForTimeout(1200);
          usedPrimary = true;
          break;
        }
      } catch (_) {
        // probeer volgende selector
      }
    }

    if (!usedPrimary) {
      // fallback: eenvoudige scroll + keyboard interactie (bot.js stijl)
      try {
        await page.waitForTimeout(1200);
        await page.evaluate(() => window.scrollTo(0, 520));
        await page.waitForTimeout(800);
        await page.mouse.click(250, 515);
        await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
        await page.keyboard.press('Backspace');
        await page.keyboard.type(String(kredietbedrag));

        try {
          await page.getByText(/Ja\s*\/\s*weet het niet/i).click({ timeout: 4000 });
        } catch {
          try { await page.getByText(/Ja/i).first().click({ timeout: 4000 }); } catch {}
        }

        await page.waitForTimeout(400);
        await page.mouse.click(165, 697);
        await page.waitForTimeout(1500);
      } catch (fbErr) {
        await page.screenshot({ path: `debug-fail-${Date.now()}.png`, fullPage: true });
        throw new Error('Fallback interaction failed: ' + fbErr.message);
      }
    }

    // Maak screenshot en gebruik OCR (Tesseract) om bedragen te lezen
    const screenshotPath = `screenshot-${Date.now()}.png`;
    await page.screenshot({ path: screenshotPath, fullPage: true });

    let tekst = '';
    try {
      const ocrResult = await Tesseract.recognize(screenshotPath, 'nld+eng');
      tekst = ocrResult.data.text || '';
    } catch (ocrErr) {
      // fallback op innerText als OCR faalt
      tekst = await page.locator('body').innerText();
    } finally {
      try { fs.unlinkSync(screenshotPath); } catch (e) {}
    }

    // Normaliseer OCR-tekst: verwijder harde returns en unicode line separators
    // en verwijder spaties binnen getallen zoals "300.000, 00" → "300.000,00"
    tekst = tekst.replace(/[\r\n\u2028\u2029\u0085]/g, ' ');
    tekst = tekst.replace(/€\s?([0-9\s.,]+)/g, (_, nums) => '€' + nums.replace(/\s+/g, ''));
    tekst = tekst.replace(/\s+/g, ' ').trim();

    let euroBedragen = tekst.match(/€\s?[0-9.,]+/g) || [];

    // Normaliseer elk bedrag naar consistent formaat: '€ 1.234,56'
    const normalizeEuro = (s) => {
      if (!s) return null;
      // verwijder retouren en unicode separators en extra whitespace, zorg geen spaties binnen nummers
      let v = s.replace(/[\r\n\u2028\u2029\u0085]/g, ' ').replace(/\s+/g, ' ').replace(/€\s?/, '€ ').trim();
      // verwijder spatie voor decimalen: '300.000, 00' -> '300.000,00'
      v = v.replace(/,\s*/g, ',');
      // Zorg dat er twee decimalen zijn
      if (!/[.,]\d{2}$/.test(v)) {
        if (/[.,]\d{1}$/.test(v)) v = v + '0';
        else v = v + ',00';
      }
      return v;
    };

    euroBedragen = euroBedragen.map(normalizeEuro);

    // Zorg voor minimaal 10 slots zodat mapping veilig is
    while (euroBedragen.length < 10) euroBedragen.push(null);

    const out = {
      kredietbedrag,
      bron: 'notaris.be',
      resultaten: {
        totaal: cleanAmount(euroBedragen[0]),
        registratiebelasting: cleanAmount(euroBedragen[1]),
        forfait: cleanAmount(euroBedragen[2]),
        hypotheekrecht: cleanAmount(euroBedragen[3]),
        retributie: cleanAmount(euroBedragen[4]),
        ereloon: cleanAmount(euroBedragen[5]),
        administratieve_kosten: cleanAmount(euroBedragen[6]),
        uitgaven_aan_derden: cleanAmount(euroBedragen[7]),
        recht_op_geschriften: cleanAmount(euroBedragen[8]),
        btw: cleanAmount(euroBedragen[9])
      }
    };

    // Sanitize all strings in the output (remove newlines, collapse spaces)
    const sanitize = (v) => {
      if (typeof v === 'string') {
        return v.replace(/[\r\n\u2028\u2029\u0085]/g, ' ').replace(/\s+/g, ' ').trim();
      }
      if (v && typeof v === 'object') {
        for (const k of Object.keys(v)) v[k] = sanitize(v[k]);
      }
      return v;
    };

    sanitize(out);
    return out;
  } finally {
    if (page) await page.close();
    if (context) await context.close();
  }
}

app.post("/bereken", async (req, res) => {
  const kredietbedrag = String(req.body.bedrag || "").replace(/[^\d]/g, "");

  if (!kredietbedrag) {
    return res.status(400).json({
      error: "Geen bedrag meegegeven"
    });
  }

  const cached = getCachedResult(kredietbedrag);
  if (cached) {
    return res.json(cached);
  }

  try {
    await waitForBrowserSlot();
    const result = await calculateNotarisKosten(kredietbedrag);
    setCachedResult(kredietbedrag, result);

    return res.json(result);
  } catch (err) {
    return res.status(500).json({
      error: "Berekening mislukt",
      details: err.message
    });
  } finally {
    releaseBrowserSlot();
  }
});

app.get("/", (req, res) => {
  res.send("Notaris bot API werkt");
});

app.get("/status", (req, res) => {
  res.json({
    activeBrowserRequests,
    cacheSize: resultCache.size,
    maxConcurrentBrowserRequests: MAX_CONCURRENT_BROWSER_REQUESTS
  });
});

const PORT = process.env.PORT || 3000;

const server = app.listen(PORT, () => {
  console.log(`API draait op poort ${PORT}`);
});

process.on("SIGINT", async () => {
  server.close();
  if (browser) {
    await browser.close();
  }
  process.exit(0);
});
