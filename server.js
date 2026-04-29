const express = require("express");

const app = express();
app.use(express.json());

app.post("/bereken", (req, res) => {
  const bedrag = Number(req.body.bedrag);

  if (!bedrag) {
    return res.status(400).json({
      error: "Geen geldig bedrag meegegeven"
    });
  }

  res.json({
    kredietbedrag: bedrag,
    totaal: "€ 8.056,36",
    resultaten: {
      "Registratiebelasting/registratierechten": "€ 3.300,00",
      "Forfait registratie bijlage(n)": "€ 100,00",
      "Hypotheekkosten - Hypotheekrecht": "€ 990,00",
      "Hypotheekkosten - Retributie": "€ 1.160,00",
      "Ereloon": "€ 812,37",
      "Administratieve kosten": "€ 855,00",
      "Uitgaven aan derden": "€ 304,00",
      "Recht op geschriften": "€ 100,00",
      "BTW": "€ 434,99"
    }
  });
});

app.get("/", (req, res) => {
  res.send("Notaris API werkt");
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`API draait op poort ${PORT}`);
});