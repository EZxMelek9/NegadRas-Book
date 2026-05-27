const express = require('express');
const axios = require('axios');
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
const ADMIN_IDS = process.env.ADMIN_IDS ? process.env.ADMIN_IDS.split(',') : [];
const WEB_URL = process.env.WEB_URL; // Render URL
const GOOGLE_SHEET_URL = process.env.GOOGLE_SHEET_URL;

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

// 🔐 በሙሉ ስም እና በሙሉ ስልክ ቁጥር ፓስወርድ የመፍጠሪያ ፈንክሽን
function generatePassword(name, phone) {
    let cleanName = name.trim();
    let cleanPhone = phone.trim();
    return `${cleanName}@${cleanPhone}`; 
}

// ቴሌግራም መልእክት መላኪያ ፈንክሽን
async function sendTelegram(method, data) {
    try {
        return await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, data);
    } catch (error) {
        console.error(`Telegram API Error (${method}):`, error.response ? error.response.data : error.message);
    }
}

// 1. ከዳሽንቦርዱ ትዕዛዝ ሲመጣ
app.post('/api/order', async (req, res) => {
    try {
        const data = req.body;
        
        // 🔑 ፓስወርዱን እዚሁ ላይ መፍጠር
        const customerPassword = generatePassword(data.name, data.phone);
        
        // መረጃውን ወደ ጎግል ሺት ከመላካችን በፊት ፓስወርዱን አብረን እንጨምራለን
        const sheetData = { ...data, customer_password: customerPassword };

        // --- 📥 መረጃውን ወደ Google Sheet የመላክ አሠራር ---
        if (GOOGLE_SHEET_URL) {
            axios.post(GOOGLE_SHEET_URL, sheetData)
                .then(() => console.log("✅ Data successfully synced with Google Sheets!"))
                .catch(err => console.error("❌ Google Sheets Sync Error:", err.message));
        }

        // በፋይል ውስጥ የደንበኛውን መረጃ አስቀምጦ መያዝ
        const users = loadUsers();
        if (data.user_id) {
            if (!users[data.user_id]) users[data.user_id] = {};
            users[data.user_id].generated_password = customerPassword;
            users[data.user_id].phone = data.phone;
            users[data.user_id].name = data.name; 
            saveUsers(users);
        }

        const adminMsg = `📚 <b>አዲስ የመጽሐፍ ትዕዛዝ</b>\n\n` +
            `📖 <b>መጽሐፍ:</b> ${data.book_title}\n` +
            `👤 <b>ስም:</b> ${data.name}\n` +
            `📞 <b>ስልክ:</b> <code>${data.phone}</code>\n` +
            `📧 <b>ኢሜል:</b> ${data.email}\n` +
            `✈️ <b>Telegram:</b> ${data.telegram_username}\n` +
            `💰 <b>ዋጋ:</b> ${data.price} ETB\n\n` +
            `🆔 <b>የደንበኛ ID:</b> <code>${data.user_id || "N/A"}</code>\n` +
            `📄 <b>የደረሰኝ ፎቶ:</b> <a href="${data.receipt_url}">እዚህ ይጫኑ</a>\n\n` +
            `🔐 <b>ለዚህ ደንበኛ የተፈጠረ ፓስወርድ:</b> <code>${customerPassword}</code>\n\n` +
            `💬 <b>ምላሽ ለመስጠት:</b> <code>/reply ${data.user_id} [መልእክት]</code>\n` +
            `📥 <b>ፋይል ለመላክ:</b> ፒዲኤፉን ስትልክ Caption ላይ: <code>/sendfile ${data.user_id}</code>`;

        for (const adminId of ADMIN_IDS) {
            await sendTelegram('sendPhoto', {
                chat_id: adminId,
                photo: data.receipt_url,
                caption: adminMsg,
                parse_mode: "HTML"
            });
        }

        if (data.user_id && data.user_id !== "N/A") {
            const customerSuccessMsg = `✅ <b>ትዕዛዝዎ በተሳካ ሁኔታ ወደ አድሚኑ ተልኳል!</b>\n\n` +
                `እባክዎን አድሚኑ የክፍያ ደረሰኝዎን አረጋግጦ በዚሁ ቦት በኩል መጽሐፉን (PDF) እስከሚልክልዎ ድረስ በትዕግስት ይጠብቁ。\n\n` +
                `ስላዘዙ እናመሰግናለን! 🙏`;
                
            await sendTelegram('sendMessage', {
                chat_id: data.user_id,
                text: customerSuccessMsg,
                parse_mode: "HTML"
            });
        }

        res.status(200).json({ success: true });
    } catch (error) {
        console.error("Order processing error:", error);
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

    const users = loadUsers();
    
    // ተጠቃሚን መመዝገብ ወይም ማደስ
    if (!users[userId]) {
        users[userId] = { 
            name: msg.from.first_name, 
            username: msg.from.username || "N/A", 
            joined_at: new Date().toLocaleString() 
        };
        saveUsers(users);
    } else {
        users[userId].name = msg.from.first_name;
        if (msg.from.username) users[userId].username = msg.from.username;
        saveUsers(users);
    }

    // --- የ /start ኮማንድ ---
    if (text === "/start") {
        const welcomeText = `📚 <b>እንኳን ወደ ነጋድራሱ በሰላም መጡ፣ ${msg.from.first_name}!</b> 👋🌟\n\n` +
            `<i>"የዛሬው አድዋ የኢኮኖሚ አድዋ ነው።"</i>\n\n` +
            `ይህ ቦት የዘመናዊው ኢትዮጵያዊ ነጋዴ የስነ-ልቦና ቁልፍ የሆነውንና በናትናኤል ብሩክ የተዘጋጀውን <b>"ነጋድራሱ"</b> መጽሐፍ በይፋ በ pdf የምታገኙበት ቦታ ነው።\n\n` +
            `የቀደሙት የሀገራችን የንግድ መሪዎች <b>ነጋድራሶች</b> በዕውቀትና በሥርዓት ሀገርን እንደመሩት ሁሉ፣ ይህ መጽሐፍ እርስዎም በፋይናንስና በትሬዲንግ ዓለም ውስጥ ስሜትን አሸንፈው አዕምሮዎን በመግዛት ስኬታማ ነጋዴ እንዲሆኑ ይመራዎታል።\n\n` +
            `⚠️ <b>የአጠቃቀም መመሪያ፦</b>\n` +
            `• መጽሐፉን ለመግዛት እና ትዕዛዝ ለመላክ ከታች በግራ በኩል ያለውን <b>'📚 order'</b> የሚለውን ትልቁን <b>Menu Button</b> ይጫኑ。\n\n` +
            `────────────────────\n\n` +
            `📚 <b>Welcome to The Negadras Bot, ${msg.from.first_name}!</b> 👋🌟\n\n` +
            `<i>"The Adwa of today is an economic Adwa."</i>\n\n` +
            `This bot is the official place to get <b>"The Negadras"</b>, the first comprehensive Amharic trading psychology book compiled by Natnael Biruk.\n\n` +
            `Just as the historic trade generals led commerce with wisdom and discipline, this book guides today's youth from emotional chaos to mental clarity, making them true leaders in Forex, Crypto, and life success.\n\n` +
            `⚠️ <b>HOW TO BUY:</b>\n` +
            `• To order the book, please click the main <b>'📚 order'</b> (Menu Button) located at the bottom left of your screen.\n\n` +
            `✨ <b>Powered by ETN ECOSYSTEM</b>\n` +
            `© 2026 ነጋድራሱ ሜሌክ ENQOPAZYON`;

        await sendTelegram('sendMessage', {
            chat_id: chatId,
            text: welcomeText,
            parse_mode: "HTML",
            reply_markup: { remove_keyboard: true }
        });
    }

    // --- የአድሚን ኮማንዶች ---
    if (isAdmin) {
        
        // 👥 አዲስ ኮማንድ፦ የተጠቃሚዎችን ዝርዝር ለማየት (/users)
        if (text === "/users") {
            const userKeys = Object.keys(users);
            if (userKeys.length === 0) {
                await sendTelegram('sendMessage', { chat_id: chatId, text: "👥 እስካሁን የተመዘገበ ተጠቃሚ የለም።" });
            } else {
                let userListMsg = `👥 <b>የቦቱ ተጠቃሚዎች ዝርዝር (${userKeys.length})</b>\n\n`;
                userKeys.forEach((uid, index) => {
                    const uName = users[uid].name || "ስም የሌለው";
                    const uUser = users[uid].username !== "N/A" ? `@${users[uid].username}` : "ዩዘርኔም የሌለው";
                    userListMsg += `${index + 1}. 👤 <b>${uName}</b> - ${uUser}\n🆔 <code>${uid}</code>\n────────────────────\n`;
                });
                await sendTelegram('sendMessage', { chat_id: chatId, text: userListMsg, parse_mode: "HTML" });
            }
        }

        // 📢 ብሮድካስት (/broadcast [መልእክት])
        else if (text.startsWith("/broadcast ")) {
            const broadcastMsg = text.replace("/broadcast ", "");
            let count = 0;
            for (const uid in users) {
                await sendTelegram('sendMessage', { chat_id: uid, text: `📢 <b>ማስታወቂያ ከነጋድራሱ</b>\n\n${broadcastMsg}`, parse_mode: "HTML" });
                count++;
            }
            await sendTelegram('sendMessage', { chat_id: chatId, text: `✅ መልእክቱ ለ ${count} ተጠቃሚዎች ተልኳል።` });
        }

        // 💬 ምላሽ መስጠት (/reply [ID] [መልእክት])
        else if (text.startsWith("/reply ")) {
            const parts = text.split(" ");
            const targetId = parts[1];
            const replyText = text.replace(`/reply ${targetId} `, "");
            
            const savedUserData = users[targetId];
            const telegramName = savedUserData && savedUserData.name ? savedUserData.name : "ያልታወቀ ተጠቃሚ";

            await sendTelegram('sendMessage', { chat_id: targetId, text: `📩 <b>ከነጋድራሱ የተላከ ምላሽ:</b>\n\n${replyText}`, parse_mode: "HTML" });
            
            // 👤 እዚህ ጋር የተጠቃሚውን ስም እና አይዲ አብሮ ያሳያል
            await sendTelegram('sendMessage', { 
                chat_id: chatId, 
                text: `✅ ምላሹ ለደንበኛ <b>${telegramName}</b> (<code>${targetId}</code>) ተልኳል።`,
                parse_mode: "HTML" 
            });
        }

        // 📊 ስታቲስቲክስ (/stats)
        else if (text === "/stats") {
            const total = Object.keys(users).length;
            await sendTelegram('sendMessage', { chat_id: chatId, text: `📊 <b>የቦቱ ስታቲስቲክስ:</b>\n\n👥 ጠቅላላ ተጠቃሚዎች: ${total}`, parse_mode: "HTML" });
        }

        // 📥 ፋይል መላክ (Document + /sendfile [ID])
        else if (msg.document && msg.caption && msg.caption.startsWith("/sendfile ")) {
            const targetId = msg.caption.split(" ")[1];
            
            const savedUserData = users[targetId];
            const finalPassword = savedUserData && savedUserData.generated_password ? savedUserData.generated_password : "በእርስዎ ስም የተዘጋጀ ፓስወርድ";
            const telegramName = savedUserData && savedUserData.name ? savedUserData.name : "ያልታወቀ ተጠቃሚ";

            const warningMsg = `📩 <b>ከነጋድራሱ የተላከ መጽሐፍ:</b>\n\n` +
                `ስላዘዙ እናመሰግናለን! የ"ነጋድራሱ" መጽሐፍ (PDF) ተያይዟል።\n\n` +
                `🔐 <b>የእርስዎ መክፈቻ ፓስወርድ (Password)፦</b> <code>${finalPassword}</code>\n\n` +
                `⚠️ <b>ማስጠንቀቂያ:</b> ይህ መጽሐፍ በባለቤትነት መብት የተጠበቀ እና የእርስዎ ስም እና ስልክ ቁጥር በፒዲኤፉ ውስጥ ተካቶ በፓስወርድ የተቆለፈ ነው። ለሌላ ሰው ማጋራት፣ ማሰራጨት ወይም መሸጥ በጥብቅ የተከለከለ እና በሕግ ያስቀጣል።`;
                
            await sendTelegram('sendDocument', {
                chat_id: targetId,
                document: msg.document.file_id,
                caption: warningMsg,
                parse_mode: "HTML"
            });
            
            // 👤 እዚህ ጋር የተጠቃሚውን ስም እና አይዲ አብሮ ያሳያል
            await sendTelegram('sendMessage', { 
                chat_id: chatId, 
                text: `✅ ፋይሉ እና ፓስወርዱ [ <code>${finalPassword}</code> ] ለደንበኛ <b>${telegramName}</b> (<code>${targetId}</code>) ተልኳል።`,
                parse_mode: "HTML"
            });
        }
    } 
    // ተራ መልእክት ከደንበኛ (Forwarding to Admins)
    else if (!text.startsWith("/")) {
        for (const adminId of ADMIN_IDS) {
            await sendTelegram('sendMessage', {
                chat_id: adminId,
                text: `📬 <b>መልእክት ከደንበኛ:</b>\n\n👤 ስም: ${msg.from.first_name}\n🆔 ID: <code>${userId}</code>\n\n💬 መልእክት: ${text}`,
                parse_mode: "HTML"
            });
        }
        await sendTelegram('sendMessage', { chat_id: chatId, text: "መልእክትዎ ደርሷል! እናመሰግናለን።" });
    }

    res.sendStatus(200);
});

// 3. Webhook ለማገናኘት
app.get('/api/set-webhook', async (req, res) => {
    const webhookUrl = `${WEB_URL}/api/telegram-webhook`;
    const response = await axios.get(`https://api.telegram.org/bot${BOT_TOKEN}/setWebhook?url=${webhookUrl}`);
    res.json(response.data);
});

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// --- ⏰ ሰርቨሩ እንዳይተኛ በየ 5 ደቂቃው ራሱን የመቀስቀሻ ኮድ (Keep-Alive Setup) ---
const KEEP_ALIVE_INTERVAL = 5 * 60 * 1000;
setInterval(async () => {
    if (WEB_URL) {
        try {
            const response = await axios.get(`${WEB_URL}`);
            console.log(`🤖 Keep-Alive Ping Sent! Status: ${response.status}`);
        } catch (error) {
            console.error("❌ Keep-Alive Ping Failed:", error.message);
        }
    }
}, KEEP_ALIVE_INTERVAL);

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
