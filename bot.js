const { chromium } = require("playwright");
const Tesseract = require("tesseract.js");

const URL = "https://www.notaris.be/rekenmodules/wonen/berekening-van-de-kosten-voor-standaardkrediet";

const kredietbedrag = "300000";

(async () => {
  console.log("🚀 Start");

  const browser = await chromium.launch({
    headless: false,
    slowMo: 300
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
    console.log("✅ Cookies toegestaan");
  } catch {
    console.log("⚠️ Geen cookie popup");
  }

  await page.waitForTimeout(1500);

  await page.evaluate(() => window.scrollTo(0, 520));
  await page.waitForTimeout(1000);

  console.log("✍️ Kredietbedrag invullen...");
  await page.mouse.click(250, 515);
  await page.keyboard.press("Meta+A");
  await page.keyboard.press("Backspace");
  await page.keyboard.type(kredietbedrag);
  console.log("✅ Bedrag ingevuld");

  await page.waitForTimeout(1000);

  console.log("🔘 Eerste vraag: Ja");
  await page.mouse.click(116, 613);

  console.log("🔘 Tweede vraag: Ja / weet het niet");

  try {
    await page.getByText(/Ja\s*\/\s*weet het niet/i).click({ timeout: 5000 });
  } catch {
    await page.mouse.click(603, 613);
  }

  await page.waitForTimeout(500);

  console.log("🧮 Berekenen...");
  await page.mouse.click(165, 697);
  console.log("✅ Bereken geklikt");

  console.log("📸 Screenshot maken...");

  await page.waitForTimeout(5000);
  await page.evaluate(() => window.scrollTo(0, 900));
  await page.waitForTimeout(1500);

  const screenshotPath = "resultaat.png";

  await page.screenshot({
    path: screenshotPath,
    fullPage: false
  });

  console.log("🔍 OCR bezig...");

  const result = await Tesseract.recognize(
    screenshotPath,
    "nld+eng"
  );

  const tekst = result.data.text;

  console.log("\n=======================");
  console.log("📊 OCR TEKST");
  console.log("=======================");
  console.log(tekst);

  console.log("\n=======================");
  console.log("📊 RESULTATEN (met labels)");
  console.log("=======================");

  const labels = [
    "Totaal",
    "Registratiebelasting/registratierechten",
    "Forfait registratie bijlage(n)",
    "Hypotheekkosten - Hypotheekrecht",
    "Hypotheekkosten - Retributie",
    "Ereloon",
    "Administratieve kosten",
    "Uitgaven aan derden",
    "Recht op geschriften",
    "BTW"
  ];

  const bedragen = tekst.match(/€\s?[\d.,]+/g) || [];

  labels.forEach((label, index) => {
    console.log(`${label}: ${bedragen[index] || "niet gevonden"}`);
  });

  console.log("\n✅ Klaar");

  await browser.close();
})();
