const express = require("express");

const app = express();
app.use(express.json());

app.post("/bereken", async (req, res) => {
  const bedrag = Number(req.body.bedrag);

  if (!bedrag) {
    return res.status(400).json({
      error: "Geen geldig bedrag meegegeven"
    });
  }

  // Voorlopige vaste output zoals je OCR-resultaat voor 300000
  const resultaat = {
    kredietbedrag: bedrag,
    totaal: "€ 8.056,36",
    registratiebelasting: "€ 3.300,00",
    forfaitRegistratieBijlagen: "€ 100,00",
    hypotheekrecht: "€ 990,00",
    retributie: "€ 1.160,00",
    ereloon: "€ 812,37",
    administratieveKosten: "€ 855,00",
    uitgavenAanDerden: "€ 304,00",
    rechtOpGeschriften: "€ 100,00",
    btw: "€ 434,99"
  };

  res.json(resultaat);
});

app.get("/", (req, res) => {
  res.send("Notaris API werkt");
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`API draait op poort ${PORT}`);
});

