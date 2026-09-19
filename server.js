const express = require("express");
const dotenv = require("dotenv");
const { Pool } = require("pg");

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(__dirname));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL
    ? { rejectUnauthorized: false }
    : false
});

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_CHAT_ID = String(process.env.CHAT_ID || "");

/* =========================
   DATABASE
========================= */

async function initDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS bookings (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      phone TEXT NOT NULL,
      service_title TEXT NOT NULL,
      tariff_name TEXT,
      tariff_price NUMERIC,
      doctor_id TEXT,
      day_label TEXT,
      date_iso DATE,
      slot TEXT,
      status TEXT DEFAULT 'Kutilmoqda',
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    ALTER TABLE bookings
    ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'Kutilmoqda'
  `);

  console.log("PostgreSQL: bookings jadvali tayyor");
}

/* =========================
   TELEGRAM API
========================= */

async function telegram(method, body = {}) {
  const url =
    `https://api.telegram.org/bot${BOT_TOKEN}/${method}`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  return await response.json();
}

/* =========================
   TELEGRAM MESSAGE
========================= */

async function sendTelegramMessage(
  chatId,
  text,
  replyMarkup = undefined
) {
  const body = {
    chat_id: chatId,
    text
  };

  if (replyMarkup) {
    body.reply_markup = replyMarkup;
  }

  const result =
    await telegram("sendMessage", body);

  if (!result.ok) {
    console.error(
      "Telegram xatosi:",
      result
    );
  }

  return result;
}

/* =========================
   CALLBACK JAVOBI
========================= */

async function answerCallbackQuery(
  callbackQueryId,
  text
) {
  return await telegram(
    "answerCallbackQuery",
    {
      callback_query_id: callbackQueryId,
      text,
      show_alert: false
    }
  );
}

/* =========================
   TELEGRAM XABARINI O'ZGARTIRISH
========================= */

async function editTelegramMessage(
  chatId,
  messageId,
  text,
  replyMarkup = undefined
) {
  const body = {
    chat_id: chatId,
    message_id: messageId,
    text
  };

  if (replyMarkup) {
    body.reply_markup = replyMarkup;
  } else {
    body.reply_markup = {
      inline_keyboard: []
    };
  }

  return await telegram(
    "editMessageText",
    body
  );
}

/* =========================
   TELEGRAM XABARINI O'CHIRISH
========================= */

async function deleteTelegramMessage(
  chatId,
  messageId
) {
  return await telegram(
    "deleteMessage",
    {
      chat_id: chatId,
      message_id: messageId
    }
  );
}

/* =========================
   NAVBAT TUGMALARI
========================= */

function bookingButtons(
  bookingId,
  status = "Kutilmoqda"
) {

  if (status === "Kutilmoqda") {

    return {
      inline_keyboard: [
        [
          {
            text: "✅ Tasdiqlash",
            callback_data:
              `confirm:${bookingId}`
          },
          {
            text: "❌ Bekor qilish",
            callback_data:
              `cancel:${bookingId}`
          }
        ],
        [
          {
            text: "🗑️ O‘chirish",
            callback_data:
              `delete:${bookingId}`
          }
        ]
      ]
    };

  }

  return {
    inline_keyboard: [
      [
        {
          text: "🗑️ O‘chirish",
          callback_data:
            `delete:${bookingId}`
        }
      ]
    ]
  };
}

/* =========================
   YANGI NAVBAT
========================= */

app.post(
  "/api/bookings",
  async (req, res) => {

    try {

      const {
        id,
        name,
        phone,
        serviceTitle,
        tariffName,
        tariffPrice,
        doctorId,
        dayLabel,
        dateISO,
        slot
      } = req.body;

      if (
        !name ||
        !phone ||
        !serviceTitle ||
        !dayLabel ||
        !slot
      ) {

        return res.status(400).json({
          ok: false,
          message:
            "Ma'lumotlar to'liq emas"
        });
      }

      const bookingId =
        id ||
        `bk_${Date.now()}_${Math.random()
          .toString(16)
          .slice(2)}`;

      await pool.query(
        `
        INSERT INTO bookings (
          id,
          name,
          phone,
          service_title,
          tariff_name,
          tariff_price,
          doctor_id,
          day_label,
          date_iso,
          slot,
          status
        )
        VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
          'Kutilmoqda'
        )
        ON CONFLICT (id) DO NOTHING
        `,
        [
          bookingId,
          name,
          phone,
          serviceTitle,
          tariffName || "",
          tariffPrice || 0,
          doctorId || "",
          dayLabel,
          dateISO || null,
          slot
        ]
      );

      const message =
`🦷 YANGI NAVBAT

👤 Bemor: ${name}
📞 Telefon: ${phone}

🦷 Xizmat: ${serviceTitle}
💳 Tarif: ${tariffName || "-"}
💰 Narx: ${tariffPrice || "-"}

👨‍⚕️ Shifokor: ${doctorId || "-"}

📅 Sana: ${dayLabel}
📆 Sana ISO: ${dateISO || "-"}
🕐 Vaqt: ${slot}

📌 Holat: Kutilmoqda

🆔 ID: ${bookingId}`;

      const telegramResult =
        await sendTelegramMessage(
          ADMIN_CHAT_ID,
          message,
          bookingButtons(
            bookingId,
            "Kutilmoqda"
          )
        );

      if (!telegramResult.ok) {

        return res.status(500).json({
          ok: false,
          message:
            "Navbat saqlandi, lekin Telegramga yuborilmadi"
        });
      }

      res.json({
        ok: true,
        message:
          "Navbat saqlandi va Telegramga yuborildi",
        bookingId
      });

    } catch (error) {

      console.error(
        "Booking xatosi:",
        error
      );

      res.status(500).json({
        ok: false,
        message:
          "Serverda xatolik yuz berdi"
      });
    }
  }
);

/* =========================
   ADMIN
========================= */

function isAdmin(msg) {
  return (
    String(msg.chat.id) ===
    ADMIN_CHAT_ID
  );
}

/* =========================
   CALLBACK
========================= */

async function handleCallbackQuery(query) {

  try {

    const msg = query.message;

    if (!msg) return;

    const chatId =
      String(query.from.id);

    if (chatId !== ADMIN_CHAT_ID) {

      await answerCallbackQuery(
        query.id,
        "⛔ Sizda admin huquqi yo'q."
      );

      return;
    }

    const data =
      query.data || "";

    const [
      action,
      bookingId
    ] = data.split(":");

    if (!bookingId) {

      await answerCallbackQuery(
        query.id,
        "❌ ID topilmadi"
      );

      return;
    }

    const result =
      await pool.query(
        `SELECT *
         FROM bookings
         WHERE id = $1`,
        [bookingId]
      );

    if (result.rows.length === 0) {

      await answerCallbackQuery(
        query.id,
        "❌ Bu navbat topilmadi."
      );

      return;
    }

    /* =====================
       TASDIQLASH
    ===================== */

    if (action === "confirm") {

      await pool.query(
        `
        UPDATE bookings
        SET status = 'Tasdiqlangan'
        WHERE id = $1
        `,
        [bookingId]
      );

      const newText =
`${msg.text}

━━━━━━━━━━━━━━
✅ HOLAT: TASDIQLANGAN`;

      await editTelegramMessage(
        msg.chat.id,
        msg.message_id,
        newText,
        bookingButtons(
          bookingId,
          "Tasdiqlangan"
        )
      );

      await answerCallbackQuery(
        query.id,
        "✅ Navbat tasdiqlandi"
      );

      return;
    }

    /* =====================
       BEKOR QILISH
    ===================== */

    if (action === "cancel") {

      await pool.query(
        `
        UPDATE bookings
        SET status = 'Bekor qilingan'
        WHERE id = $1
        `,
        [bookingId]
      );

      const newText =
`${msg.text}

━━━━━━━━━━━━━━
❌ HOLAT: BEKOR QILINGAN`;

      await editTelegramMessage(
        msg.chat.id,
        msg.message_id,
        newText,
        bookingButtons(
          bookingId,
          "Bekor qilingan"
        )
      );

      await answerCallbackQuery(
        query.id,
        "❌ Navbat bekor qilindi"
      );

      return;
    }

    /* =====================
       O'CHIRISH
    ===================== */

    if (action === "delete") {

      await pool.query(
        `DELETE FROM bookings
         WHERE id = $1`,
        [bookingId]
      );

      await deleteTelegramMessage(
        msg.chat.id,
        msg.message_id
      );

      await answerCallbackQuery(
        query.id,
        "🗑️ Navbat o‘chirildi"
      );

      return;
    }

    await answerCallbackQuery(
      query.id,
      "❓ Noma'lum buyruq"
    );

  } catch (error) {

    console.error(
      "Callback xatosi:",
      error
    );

    await answerCallbackQuery(
      query.id,
      "❌ Xatolik yuz berdi"
    );
  }
}

/* =========================
   TELEGRAM BUYRUQLARI
========================= */

let telegramOffset = 0;
let pollingRunning = false;

async function handleTelegramUpdate(
  update
) {

  /* CALLBACK */

  if (update.callback_query) {

    await handleCallbackQuery(
      update.callback_query
    );

    return;
  }

  const msg =
    update.message;

  if (
    !msg ||
    !msg.text
  ) {
    return;
  }

  const chatId =
    String(msg.chat.id);

  const text =
    msg.text.trim();

  console.log(
    `Telegram buyruq: ${text} | chat_id: ${chatId}`
  );

  /* ADMIN TEKSHIRISH */

  if (!isAdmin(msg)) {

    await sendTelegramMessage(
      chatId,
      "⛔ Sizda admin huquqi yo'q."
    );

    return;
  }

  /* =====================
     START
  ===================== */

  if (text === "/start") {

    await sendTelegramMessage(
      chatId,
`🦷 FARG'ONA STOMATOLOGIYA

Admin paneliga xush kelibsiz.

Buyruqlarni ko'rish uchun:
/yordam`
    );

    return;
  }

  /* =====================
     YORDAM
  ===================== */

  if (text === "/yordam") {

    await sendTelegramMessage(
      chatId,
`📋 ADMIN BUYRUQLARI

/navbatlar
➡️ Barcha navbatlar

/bugun
➡️ Bugungi navbatlar

/ertaga
➡️ Ertangi navbatlar

/oy
➡️ Shu oy navbatlari

/statistika
➡️ Umumiy statistika

/shifokorlar
➡️ Shifokorlar statistikasi

/yordam
➡️ Buyruqlar ro'yxati

📌 Har bir yangi navbatda:

✅ Tasdiqlash
❌ Bekor qilish
🗑️ O'chirish
tugmalari mavjud.`
    );

    return;
  }

  /* =====================
     NAVBATLAR
  ===================== */

  if (text === "/navbatlar") {

    await sendBookingList(
      chatId,
      "BARCHA NAVBATLAR",
      ""
    );

    return;
  }

  /* =====================
     BUGUN
  ===================== */

  if (text === "/bugun") {

    await sendBookingList(
      chatId,
      "BUGUNGI NAVBATLAR",
      "today"
    );

    return;
  }

  /* =====================
     ERTAGA
  ===================== */

  if (text === "/ertaga") {

    await sendBookingList(
      chatId,
      "ERTANGI NAVBATLAR",
      "tomorrow"
    );

    return;
  }

  /* =====================
     OY
  ===================== */

  if (text === "/oy") {

    await sendBookingList(
      chatId,
      "SHU OY NAVBATLARI",
      "month"
    );

    return;
  }

  /* =====================
     STATISTIKA
  ===================== */

  if (text === "/statistika") {

    await sendStatistics(
      chatId
    );

    return;
  }

  /* =====================
     SHIFOKORLAR
  ===================== */

  if (text === "/shifokorlar") {

    await sendDoctorsStatistics(
      chatId
    );

    return;
  }

  /* =====================
     NOTO'G'RI BUYRUQ
  ===================== */

  if (text.startsWith("/")) {

    await sendTelegramMessage(
      chatId,
`❓ Bunday buyruq topilmadi.

Buyruqlar:

/yordam
/navbatlar
/bugun
/ertaga
/oy
/statistika
/shifokorlar`
    );
  }
}

/* =========================
   STATISTIKA
========================= */

async function sendStatistics(
  chatId
) {

  try {

    const result =
      await pool.query(`
        SELECT

          COUNT(*)::int
          AS total,

          COUNT(*) FILTER (
            WHERE status =
              'Kutilmoqda'
          )::int
          AS pending,

          COUNT(*) FILTER (
            WHERE status =
              'Tasdiqlangan'
          )::int
          AS confirmed,

          COUNT(*) FILTER (
            WHERE status =
              'Bekor qilingan'
          )::int
          AS cancelled,

          COUNT(*) FILTER (
            WHERE date_iso =
              (
                NOW()
                AT TIME ZONE
                'Asia/Tashkent'
              )::date
          )::int
          AS today,

          COUNT(*) FILTER (
            WHERE date_iso >=
              DATE_TRUNC(
                'month',
                (
                  NOW()
                  AT TIME ZONE
                  'Asia/Tashkent'
                )
              )::date

            AND date_iso <
              (
                DATE_TRUNC(
                  'month',
                  (
                    NOW()
                    AT TIME ZONE
                    'Asia/Tashkent'
                  )
                )
                + INTERVAL '1 month'
              )::date
          )::int
          AS this_month

        FROM bookings
      `);

    const stats =
      result.rows[0];

    const message =
`📊 STOMATOLOGIYA STATISTIKASI

📋 Jami navbatlar:
${stats.total} ta

⏳ Kutilmoqda:
${stats.pending} ta

✅ Tasdiqlangan:
${stats.confirmed} ta

❌ Bekor qilingan:
${stats.cancelled} ta

📅 Bugungi navbatlar:
${stats.today} ta

📆 Shu oy:
${stats.this_month} ta`;

    await sendTelegramMessage(
      chatId,
      message
    );

  } catch (error) {

    console.error(
      "Statistika xatosi:",
      error
    );

    await sendTelegramMessage(
      chatId,
      "❌ Statistikani olishda xatolik yuz berdi."
    );
  }
}

/* =========================
   SHIFOKORLAR STATISTIKASI
========================= */

async function sendDoctorsStatistics(
  chatId
) {

  try {

    const result =
      await pool.query(`
        SELECT

          doctor_id,

          COUNT(*)::int
          AS total,

          COUNT(*) FILTER (
            WHERE status =
              'Kutilmoqda'
          )::int
          AS pending,

          COUNT(*) FILTER (
            WHERE status =
              'Tasdiqlangan'
          )::int
          AS confirmed,

          COUNT(*) FILTER (
            WHERE status =
              'Bekor qilingan'
          )::int
          AS cancelled

        FROM bookings

        WHERE
          doctor_id IS NOT NULL

          AND TRIM(
            doctor_id
          ) <> ''

        GROUP BY
          doctor_id

        ORDER BY
          total DESC
      `);

    if (
      result.rows.length === 0
    ) {

      await sendTelegramMessage(
        chatId,
`👨‍⚕️ SHIFOKORLAR STATISTIKASI

📭 Hozircha shifokorlar bo‘yicha navbatlar mavjud emas.`
      );

      return;
    }

    let message =
`👨‍⚕️ SHIFOKORLAR STATISTIKASI

`;

    result.rows.forEach(
      (doctor, index) => {

        message +=
`${index + 1}. 👨‍⚕️ ${doctor.doctor_id}

📋 Jami:
${doctor.total} ta

⏳ Kutilmoqda:
${doctor.pending} ta

✅ Tasdiqlangan:
${doctor.confirmed} ta

❌ Bekor qilingan:
${doctor.cancelled} ta

━━━━━━━━━━━━━━

`;

      }
    );

    await sendLongTelegramMessage(
      chatId,
      message
    );

  } catch (error) {

    console.error(
      "Shifokorlar statistikasi xatosi:",
      error
    );

    await sendTelegramMessage(
      chatId,
      "❌ Shifokorlar statistikasini olishda xatolik yuz berdi."
    );
  }
}

/* =========================
   NAVBATLAR RO'YXATI
========================= */

async function sendBookingList(
  chatId,
  title,
  filter
) {

  try {

    let query = "";

    /* BARCHASI */

    if (filter === "") {

      query = `
        SELECT *
        FROM bookings

        ORDER BY
          date_iso ASC
          NULLS LAST,

          slot ASC
          NULLS LAST,

          created_at DESC

        LIMIT 100
      `;
    }

    /* BUGUN */

    else if (
      filter === "today"
    ) {

      query = `
        SELECT *
        FROM bookings

        WHERE date_iso =
          (
            NOW()
            AT TIME ZONE
            'Asia/Tashkent'
          )::date

        ORDER BY
          slot ASC
          NULLS LAST,

          created_at ASC
      `;
    }

    /* ERTAGA */

    else if (
      filter === "tomorrow"
    ) {

      query = `
        SELECT *
        FROM bookings

        WHERE date_iso =
          (
            (
              NOW()
              AT TIME ZONE
              'Asia/Tashkent'
            )::date + 1
          )

        ORDER BY
          slot ASC
          NULLS LAST,

          created_at ASC
      `;
    }

    /* SHU OY */

    else if (
      filter === "month"
    ) {

      query = `
        SELECT *
        FROM bookings

        WHERE date_iso >=
          DATE_TRUNC(
            'month',
            (
              NOW()
              AT TIME ZONE
              'Asia/Tashkent'
            )
          )::date

        AND date_iso <
          (
            DATE_TRUNC(
              'month',
              (
                NOW()
                AT TIME ZONE
                'Asia/Tashkent'
              )
            )
            + INTERVAL '1 month'
          )::date

        ORDER BY
          date_iso ASC,

          slot ASC
          NULLS LAST
      `;
    }

    const result =
      await pool.query(query);

    if (
      result.rows.length === 0
    ) {

      await sendTelegramMessage(
        chatId,
`${title}

📭 Hozircha navbatlar mavjud emas.`
      );

      return;
    }

    let message =
`${title}

📊 Jami:
${result.rows.length} ta

`;

    result.rows.forEach(
      (booking, index) => {

        const statusIcon =
          booking.status ===
          "Tasdiqlangan"
            ? "✅"
            : booking.status ===
              "Bekor qilingan"
            ? "❌"
            : "⏳";

        message +=
`${index + 1}. 👤 ${booking.name}
📞 ${booking.phone}
🦷 ${booking.service_title}
💳 ${booking.tariff_name || "-"}
💰 ${booking.tariff_price || "-"}
👨‍⚕️ ${booking.doctor_id || "-"}
📅 ${booking.day_label || booking.date_iso || "-"}
🕐 ${booking.slot || "-"}
${statusIcon} Holat: ${booking.status || "Kutilmoqda"}
🆔 ${booking.id}

`;

      }
    );

    await sendLongTelegramMessage(
      chatId,
      message
    );

  } catch (error) {

    console.error(
      "Navbatlarni olish xatosi:",
      error
    );

    await sendTelegramMessage(
      chatId,
      "❌ Navbatlarni olishda xatolik yuz berdi."
    );
  }
}

/* =========================
   UZUN TELEGRAM XABAR
========================= */

async function sendLongTelegramMessage(
  chatId,
  text
) {

  const maxLength = 3800;

  if (
    text.length <= maxLength
  ) {

    await sendTelegramMessage(
      chatId,
      text
    );

    return;
  }

  let current = "";

  const lines =
    text.split("\n");

  for (
    const line of lines
  ) {

    if (
      current.length +
      line.length +
      1 >
      maxLength
    ) {

      await sendTelegramMessage(
        chatId,
        current
      );

      current = "";
    }

    current +=
      line + "\n";
  }

  if (
    current.trim()
  ) {

    await sendTelegramMessage(
      chatId,
      current
    );
  }
}

/* =========================
   TELEGRAM POLLING
========================= */

async function startTelegramPolling() {

  if (pollingRunning) {
    return;
  }

  pollingRunning = true;

  console.log(
    "Telegram bot polling ishga tushmoqda..."
  );

  try {

    const me =
      await telegram(
        "getMe"
      );

    if (!me.ok) {

      console.error(
        "Telegram BOT_TOKEN xatosi:",
        me
      );

      return;
    }

    console.log(
      `Telegram bot ulandi: @${me.result.username}`
    );

    while (true) {

      try {

        const result =
          await telegram(
            "getUpdates",
            {
              offset:
                telegramOffset,

              timeout: 30,

              allowed_updates: [
                "message",
                "callback_query"
              ]
            }
          );

        if (!result.ok) {

          console.error(
            "Telegram getUpdates xatosi:",
            result
          );

          await new Promise(
            resolve =>
              setTimeout(
                resolve,
                5000
              )
          );

          continue;
        }

        for (
          const update
          of result.result
        ) {

          telegramOffset =
            update.update_id + 1;

          await handleTelegramUpdate(
            update
          );
        }

      } catch (error) {

        console.error(
          "Telegram polling xatosi:",
          error.message
        );

        await new Promise(
          resolve =>
            setTimeout(
              resolve,
              5000
            )
        );
      }
    }

  } catch (error) {

    console.error(
      "Telegram bot ishga tushirish xatosi:",
      error.message
    );
  }
}

/* =========================
   SERVER
========================= */

async function startServer() {

  try {

    await initDatabase();

    app.listen(
      PORT,
      () => {

        console.log(
          `Server ishga tushdi: http://localhost:${PORT}`
        );

        startTelegramPolling();
      }
    );

  } catch (error) {

    console.error(
      "Serverni ishga tushirishda xatolik:",
      error
    );

    process.exit(1);
  }
}

startServer();
