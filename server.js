const express = require("express");
const { chromium } = require("playwright");

const app = express();

app.use(express.json());

const URL =
  "https://www.notaris.be/rekenmodules/wonen/berekening-van-de-kosten-voor-standaardkrediet";

function cleanAmount(value) {
  if (!value) return null;

  return value
    .replace(/\s+/g, " ")
    .replace("\n", "")
    .trim();
}

app.post("/bereken", async (req, res) => {
  const kredietbedrag = String(req.body.bedrag || "").replace(/[^\d]/g, "");

  if (!kredietbedrag) {
    return res.status(400).json({
      error: "Geen bedrag meegegeven"
    });
  }

  let browser;

  try {
    console.log("Start berekening:", kredietbedrag);

    browser = await chromium.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage"
      ]
    });

    console.log("Browser gestart");

    const page = await browser.newPage({
      viewport: {
        width: 1650,
        height: 1000
      }
    });

    await page.route("**/*", route => {
      const type = route.request().resourceType();

      if (
        type === "image" ||
        type === "font" ||
        type === "media" ||
        type === "stylesheet"
      ) {
        route.abort();
      } else {
        route.continue();
      }
    });

    await page.goto(URL, {
      waitUntil: "domcontentloaded",
      timeout: 30000
    });

    console.log("Pagina geladen");

    try {
      await page
        .getByText("ALLE COOKIES TOESTAAN", {
          exact: false
        })
        .click({
          timeout: 2000
        });

      console.log("Cookies geaccepteerd");
    } catch {
      console.log("Geen cookie popup");
    }

    const inputs = await page
      .locator(
        'input:not([type="submit"]):not([type="button"]):not([type="hidden"])'
      )
      .all();

    console.log("Aantal bruikbare inputs:", inputs.length);

    if (inputs.length < 2) {
      throw new Error("Niet genoeg invulvelden gevonden");
    }

    await inputs[0].fill(kredietbedrag);
    console.log("Input 1 ingevuld");

    await inputs[1].fill(kredietbedrag);
    console.log("Input 2 ingevuld");

    if (inputs[2]) {
      const aanhorigheden = Math.round(
        Number(kredietbedrag) * 0.1
      );

      await inputs[2].fill(String(aanhorigheden));

      console.log("Input 3 ingevuld");
    }

    await page.getByText("Bereken", {
      exact: false
    }).click();

    console.log("Bereken geklikt");

    await page.waitForSelector("text=Resultaten", {
      timeout: 10000
    });

    console.log("Resultaten gevonden");

    const bodyText = await page.locator("body").innerText();

    function getAmountAfter(labelRegex) {
      const regex = new RegExp(
        labelRegex + "[\\s\\S]{0,150}?(€\\s?[\\d.,]+)",
        "i"
      );

      const match = bodyText.match(regex);

      return match ? cleanAmount(match[1]) : null;
    }

    const totaalMatch = bodyText.match(
      /geraamd op\s*(€\s?[\d.,]+)/i
    );

    const resultaten = {
      totaal: totaalMatch
        ? cleanAmount(totaalMatch[1])
        : null,

      registratiebelasting: getAmountAfter(
        "Registratiebelasting\\/registratierechten"
      ),

      forfait: getAmountAfter(
        "Forfait registratie bijlage"
      ),

      hypotheekrecht: getAmountAfter(
        "Hypotheekkosten\\s*-\\s*Hypotheekrecht"
      ),

      retributie: getAmountAfter(
        "Hypotheekkosten\\s*-\\s*Retributie"
      ),

      ereloon: getAmountAfter("Ereloon"),

      administratieve_kosten: getAmountAfter(
        "Administratieve kosten"
      ),

      uitgaven_aan_derden: getAmountAfter(
        "Uitgaven aan derden"
      ),

      recht_op_geschriften: getAmountAfter(
        "Recht op geschriften"
      ),

      btw: getAmountAfter("BTW")
    };

    console.log("RESULTATEN:", resultaten);

    return res.json({
      succes: true,
      kredietbedrag,
      bron: "notaris.be",
      resultaten
    });
  } catch (err) {
    console.error("VOLLEDIGE FOUT:", err);

    return res.status(500).json({
      succes: false,
      error: "Berekening mislukt",
      details: err.message,
      stack: err.stack
    });
  } finally {
    if (browser) {
      await browser.close();

      console.log("Browser gesloten");
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