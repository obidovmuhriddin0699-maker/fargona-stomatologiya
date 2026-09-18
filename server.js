const express = require("express");
const dotenv = require("dotenv");

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(__dirname));

app.post("/api/bookings", async (req, res) => {
  try {
    const { name, phone, serviceTitle, tariffName, tariffPrice, doctorId, dayLabel, dateISO, slot } = req.body;

    if (!name || !phone || !serviceTitle || !dayLabel || !slot) {
      return res.status(400).json({ ok: false, message: "Ma'lumotlar to'liq emas" });
    }

    const message =
`🦷 YANGI NAVBAT

👤 Bemor: ${name}
📞 Telefon: ${phone}

🦷 Xizmat: ${serviceTitle}
💳 Tarif: ${tariffName}
💰 Narx: ${tariffPrice}

👨‍⚕️ Shifokor: ${doctorId}

📅 Sana: ${dayLabel}
📆 Sana ISO: ${dateISO}
🕐 Vaqt: ${slot}

✅ Sayt orqali yangi navbat olindi.`;

    const telegramUrl = `https://api.telegram.org/bot${process.env.BOT_TOKEN}/sendMessage`;

    const response = await fetch(telegramUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: process.env.CHAT_ID, text: message })
    });

    const result = await response.json();

    if (!result.ok) {
      console.error("Telegram xatosi:", result);
      return res.status(500).json({ ok: false, message: "Telegramga yuborishda xatolik" });
    }

    res.json({ ok: true, message: "Navbat Telegramga yuborildi" });
  } catch (error) {
    console.error("Server xatosi:", error);
    res.status(500).json({ ok: false, message: "Serverda xatolik yuz berdi" });
  }
});

app.listen(PORT, () => {
  console.log(`Server ishga tushdi: http://localhost:${PORT}`);
});
