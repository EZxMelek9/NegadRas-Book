const express = require('express');
const axios = require('axios'); // ‹-- ተስተካክሏል፡ axios እዚህ ጋር እንዲገባ ተደርጓል
const cors = require('cors');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// ⚠️ Environment Variables
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_IDS = process.env.ADMIN_IDS ? process.env.ADMIN_IDS.split(',') : ["5569487012"];
const WEB_URL = process.env.WEB_URL; // Render URL

// ዳታቤዝ ፋይል (ቀላል JSON ፋይል ተጠቃሚዎችን ለመመዝገብ)
const DB_FILE = path.join(__dirname, 'users.json');

// ተጠቃሚዎችን ከፋይል ማንበብ
function loadUsers() {
    if (!fs.existsSync(DB_FILE)) return {};
    try {
        return JSON.parse(fs.readFileSync(DB_FILE));
    } catch (e) {
        return {};
    }
}

// ተጠቃሚዎችን ወደ ፋይል መጻፍ
function saveUsers(users) {
    fs.writeFileSync(DB_FILE, JSON.stringify(users, null, 2));
}

// ቴሌግራም መልእክት መላኪያ ፈንክሽን
async function sendTelegram(method, data) {
    try {
        return await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, data);
    } catch (error) {
        console.error(`Telegram API Error (${method}):`, error.response ? error.response.data : error.message);
    }
}

// 1. ከዳሽቦርዱ ትዕዛዝ ሲመጣ
app.post('/api/order', async (req, res) => {
    try {
        const data = req.body;
        // ‹-- ተስተካክሏል፡ የሊንክ ስህተት እንዳይፈጠር ማርክዳውኑ ወደ HTML ተቀይሯል
        const adminMsg = `📚 <b>አዲስ የመጽሐፍ ትዕዛዝ</b>\n\n` +
            `📖 <b>መጽሐፍ:</b> ${data.book_title}\n` +
            `👤 <b>ስም:</b> ${data.name}\n` +
            `📞 <b>ስልክ:</b> <code>${data.phone}</code>\n` +
            `📧 <b>ኢሜል:</b> ${data.email}\n` +
            `✈️ <b>Telegram:</b> ${data.telegram_username}\n` +
            `💰 <b>ዋጋ:</b> ${data.price} ETB\n\n` +
            `🆔 <b>የደንበኛ ID:</b> <code>${req.body.user_id || "N/A"}</code>\n` +
            `📄 <b>የደረሰኝ ፎቶ:</b> <a href="${data.receipt_url}">እዚህ ይጫኑ</a>\n\n` +
            `💬 <b>ምላሽ ለመስጠት:</b> <code>/reply ${req.body.user_id} [መልእክት]</code>\n` +
            `📥 <b>ፋይል ለመላክ:</b> ፒዲኤፉን ስትልክ Caption ላይ: <code>/sendfile ${req.body.user_id}</code>`;

        for (const adminId of ADMIN_IDS) {
            await sendTelegram('sendPhoto', {
                chat_id: adminId,
                photo: data.receipt_url,
                caption: adminMsg,
                parse_mode: "HTML" // ‹-- ወደ HTML ተቀይሯል
            });
        }

        res.status(200).json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false });
    }
});

// 2. ቴሌግራም ቦት ኮማንዶችን ለማስተናገድ (Webhook)
app.post('/api/telegram-webhook', async (req, res) => {
    const update = req.body;
    if (!update.message) return res.sendStatus(200);

    const msg = update.message;
    const chatId = msg.chat.id;
    const text = msg.text || "";
    const userId = msg.from.id.toString();
    const isAdmin = ADMIN_IDS.includes(userId);

    // ተጠቃሚን መመዝገብ
    const users = loadUsers();
    if (!users[userId]) {
        users[userId] = { name: msg.from.first_name, username: msg.from.username, joined_at: new Date().toLocaleString() };
        saveUsers(users);
    }

    // --- የ /start ኮማንድ ---
    if (text === "/start") {
        const welcomeText = `📚 እንኳን ደህና መጡ ${msg.from.first_name}! 🌟\n\n` +
            `ወደ ነጋድራስ የመጽሐፍ መደብር እንኳን በሰላም መጡ።\n\n` +
            `ጥራት ያላቸውን መጽሐፍት እዚህ ያገኛሉ። መጽሐፍ ለመግዛት ከታች ያለውን '📚 መጽሐፍ ግዛ' የሚለውን ይጫኑ Light.`;

        await sendTelegram('sendMessage', {
            chat_id: chatId,
            text: welcomeText,
            reply_markup: {
                keyboard: [[{ text: "📚 መጽሐፍ ግዛ", web_app: { url: WEB_URL } }]],
                resize_keyboard: true
            }
        });
    }

    // --- የአድሚን ኮማንዶች ---
    if (isAdmin) {
        // 📢 ብሮድካስት (/broadcast [መልእክት])
        if (text.startsWith("/broadcast ")) {
            const broadcastMsg = text.replace("/broadcast ", "");
            let count = 0;
            for (const uid in users) {
                await sendTelegram('sendMessage', { chat_id: uid, text: `📢 <b>ማስታወቂያ ከዕንቆጳዝዮን</b>\n\n${broadcastMsg}`, parse_mode: "HTML" });
                count++;
            }
            await sendTelegram('sendMessage', { chat_id: chatId, text: `✅ መልእክቱ ለ ${count} ተጠቃሚዎች ተልኳል።` });
        }

        // 💬 ምላሽ መስጠት (/reply [ID] [መልእክት])
        else if (text.startsWith("/reply ")) {
            const parts = text.split(" ");
            const targetId = parts[1];
            const replyText = text.replace(`/reply ${targetId} `, "");
            await sendTelegram('sendMessage', { chat_id: targetId, text: `📩 <b>ከዕንቆጳዝዮን የተላከ ምላሽ:</b>\n\n${replyText}`, parse_mode: "HTML" });
            await sendTelegram('sendMessage', { chat_id: chatId, text: `✅ ምላሹ ለ ${targetId} ተልኳል።` });
        }

        // 📊 ስታቲስቲክስ (/stats)
        else if (text === "/stats") {
            const total = Object.keys(users).length;
            await sendTelegram('sendMessage', { chat_id: chatId, text: `📊 <b>የቦቱ ስታቲስቲክስ:</b>\n\n👥 ጠቅላላ ተጠቃሚዎች: ${total}`, parse_mode: "HTML" });
        }

        // 📥 ፋይል መላክ (Document + /sendfile [ID])
        else if (msg.document && msg.caption && msg.caption.startsWith("/sendfile ")) {
            const targetId = msg.caption.split(" ")[1];
            const warningMsg = `📩 <b>ከዕንቆጳዝዮን የተላከ መጽሐፍ:</b>\n\nስላዘዙ እናመሰግናለን! መጽሐፉ ተያይዟል።\n\n⚠️ <b>ማስጠንቀቂያ:</b> ይህ መጽሐፍ የባለቤትነት መብቱ በህግ የተጠበቀ ነው። ለሌላ ማጋራት ወይም መሸጥ በጥብቅ የተከለከለ እና በህግ ያስቀጣል።`;
            await sendTelegram('sendDocument', {
                chat_id: targetId,
                document: msg.document.file_id,
                caption: warningMsg,
                parse_mode: "HTML"
            });
            await sendTelegram('sendMessage', { chat_id: chatId, text: `✅ ፋይሉ ለ ${targetId} ተልኳል።` });
        }
    } 
    // ተራ መልእክት ከደንበኛ (Forwarding to Admins)
    else if (!text.startsWith("/")) {
        for (const adminId of ADMIN_IDS) {
            await sendTelegram('sendMessage', {
                chat_id: adminId,
                text: `📬 <b>מלእክት ከደንበኛ:</b>\n\n👤 ስም: ${msg.from.first_name}\n🆔 ID: <code>${userId}</code>\n\n💬 መልእክት: ${text}`,
                parse_mode: "HTML"
            });
        }
        await sendTelegram('sendMessage', { chat_id: chatId, text: "መልእክትዎ ደርሷል! እናመሰግናለን።" });
    }

    res.sendStatus(200);
});

// 3. Webhook ለማገናኘት (ይህንን አንድ ጊዜ በብሮውዘር መክፈት አለብህ)
app.get('/api/set-webhook', async (req, res) => {
    const webhookUrl = `${WEB_URL}/api/telegram-webhook`;
    const response = await axios.get(`https://api.telegram.org/bot${BOT_TOKEN}/setWebhook?url=${webhookUrl}`);
    res.json(response.data);
});

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});