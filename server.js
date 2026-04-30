const express = require("express");
const { chromium } = require("playwright");
const Tesseract = require("tesseract.js");

const app = express();
app.use(express.json());

const URL = "https://www.notaris.be/rekenmodules/wonen/berekening-van-de-kosten-voor-standaardkrediet";

app.post("/bereken", async (req, res) => {
  const kredietbedrag = String(req.body.bedrag || "");

  if (!kredietbedrag) {
    return res.status(400).json({ error: "Geen bedrag meegegeven" });
  }

  let browser;

  try {
    browser = await chromium.launch({
      headless: true
    });

    const page = await browser.newPage({
      viewport: { width: 1650, height: 920 }
    });

    await page.goto(URL, {
      waitUntil: "load",
      timeout: 60000
    });

    try {
      await page.getByText("ALLE COOKIES TOESTAAN", { exact: false }).click({ timeout: 5000 });
    } catch {}

    await page.waitForTimeout(1500);

    await page.evaluate(() => window.scrollTo(0, 520));
    await page.waitForTimeout(1000);

    // Bedrag invullen
    await page.mouse.click(250, 515);
    await page.keyboard.press("Meta+A");
    await page.keyboard.press("Backspace");
    await page.keyboard.type(kredietbedrag);

    await page.waitForTimeout(1000);

    // Radios
    await page.mouse.click(116, 613); // Ja
    await page.mouse.click(603, 613); // Ja / weet het niet

    await page.waitForTimeout(500);

    // Bereken
    await page.mouse.click(165, 697);

    await page.waitForTimeout(5000);

    await page.evaluate(() => window.scrollTo(0, 900));
    await page.waitForTimeout(1500);

    const screenshotPath = "/tmp/resultaat.png";

    await page.screenshot({
      path: screenshotPath,
      fullPage: false
    });

    const result = await Tesseract.recognize(
      screenshotPath,
      "nld+eng"
    );

    const tekst = result.data.text;

    const bedragen = tekst.match(/€\s?[\d.,]+/g) || [];

    const labels = [
      "totaal",
      "registratiebelasting",
      "forfaitRegistratieBijlagen",
      "hypotheekrecht",
      "retributie",
      "ereloon",
      "administratieveKosten",
      "uitgavenAanDerden",
      "rechtOpGeschriften",
      "btw"
    ];

    const output = {};

    labels.forEach((label, index) => {
      output[label] = bedragen[index] || null;
    });

    return res.json({
      kredietbedrag,
      bron: "notaris.be",
      resultaten: output,
      ocrTekst: tekst
    });

  } catch (err) {
    return res.status(500).json({
      error: "Berekening mislukt",
      details: err.message
    });
  } finally {
    if (browser) {
      await browser.close();
    }
  }
});

app.get("/", (req, res) => {
  res.send("Notaris bot API werkt");
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`API draait op poort ${PORT}`);
});