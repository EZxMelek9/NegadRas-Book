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
const NEW_BOT_TOKEN = process.env.NEW_BOT_TOKEN || process.env.BOT_TOKEN; 
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

// 🔐 ፓስወርድ የመፍጠሪያ ፈንክሽን
function generatePassword(name, phone) {
    let cleanName = name.trim().replace(/\s+/g, '_');
    let cleanPhone = phone.trim();
    return `${cleanName}@${cleanPhone}`; 
}

// ቴሌግрам መልእክት መላኪያ ፈንክሽን
async function sendTelegram(method, data) {
    try {
        return await axios.post(`https://api.telegram.org/bot${NEW_BOT_TOKEN}/${method}`, data);
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
        
        // 🔥 መረጃውን ወደ ጎግል ሺት ከመላካችን በፊት ፓስወርዱን እንጨምራለን
        const sheetData = { 
            ...data, 
            action: "new_order", 
            package_type: data.package_type, 
            customer_password: customerPassword 
        };

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
            users[data.user_id].purchased_package = data.package_type; 
            saveUsers(users);
        }

        // 🚨 አድሚኑ ጋር የሚደርስ መግለጫ
        const adminMsg = `🚨 <b>አዲስ የሽያጭ ትዕዛዝ መጥቷል!</b>\n\n` +
            `🔥 <b>የተገዛው ጥቅል (Package):</b> 🔴 <b>[ ${data.package_type ? data.package_type.toUpperCase() : "N/A"} ]</b> 🔴\n` +
            `🛍️ <b>ዝርዝር መግለጫ:</b> ${data.book_title || "N/A"}\n` +
            `👤 <b>በዳሽቦርድ የሞላው ስም:</b> ${data.name || "N/A"}\n` +
            `📞 <b>ስልክ:</b> <code>${data.phone || "N/A"}</code>\n` +
            `📧 <b>ኢሜል:</b> ${data.email || "N/A"}\n` +
            `✈️ <b>Telegram:</b> ${data.telegram_username || "N/A"}\n` +
            `💰 <b>ዋጋ:</b> ${data.price || "0"} ETB\n\n` +
            `🆔 <b>የደንበኛ ID:</b> <code>${data.user_id || "N/A"}</code>\n` +
            `📄 <b>የደረሰኝ ፎቶ:</b> <a href="${data.receipt_url}">እዚህ ይጫኑ</a>\n\n` +
            `🔐 <b>ለዚህ ደንበኛ የተፈጠረ ፓስወርድ:</b> <code>${customerPassword}</code>\n\n` +
            `────────────────────\n` +
            `📥 <b>ፋይሉን ለመላክ፦</b>\n` +
            `Caption ላይ: <code>/sendfile ${data.user_id} ${customerPassword}</code>\n\n` +
            `📥 <b>መለእክት ለመላክ (Hint: ለ${data.name || "ደንበኛ"})፦</b>\n` +
            `<code>/reply ${data.user_id} 👋 ሰላም ${data.name || "ደንበኛ"}፦ </code>`;

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
                `እባክዎን አድሚኑ የክፍያ ደረሰኝዎን አረጋግጦ በዚሁ ቦት በኩል መጽሐፉን (PDF) ወይም የቪዲዮ ስልጠና ሊንኮችን እስከሚልክልዎ ድረስ በትዕግስት ይጠብቁ。\n\n` +
                `ስላዘዙ እናመሰግናለን! 🙏\n\n` +
                `ነጋድራሱ `;
                
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

        if (GOOGLE_SHEET_URL) {
            const userDataToSheet = {
                action: "bot_start",
                user_id: userId,
                name: msg.from.first_name,
                telegram_username: msg.from.username ? `@${msg.from.username}` : "N/A"
            };
            axios.post(GOOGLE_SHEET_URL, userDataToSheet).catch(e => console.error(e.message));
        }
    } else {
        users[userId].name = msg.from.first_name;
        if (msg.from.username) users[userId].username = msg.from.username;
        saveUsers(users);
    }

    // --- የ /start ኮማንድ ---
    if (text === "/start") {
        const welcomeText = `📚 <b>እንኳን ወደ ነጋድራሱ በሰላም መጡ፣ ${msg.from.first_name}!</b> 👋🌟\n\n` +
            `<i>"የዛሬው አድዋ የኢኮኖሚ አድዋ ነው።"</i>\n\n` +
            `ይህ ቦት በናትናኤል ብሩክ የተዘጋጀውን የትሬዲንግ ስነ-ልቦና መቆጣጠሪያ <b>"ነጋድራሱ"</b> መጽሐፍ እና የቪዲዮ ስልጠናዎችን በይፋ የሚያገኙበት ቦታ ነው።\n\n` +
            `🔥 <b>የእኛ የሽያጭ አማራጮች (Packages)፦</b>\n\n` +
            `1️⃣ <b>"ነጋድራሱ" መጽሐፍ (PDF) ብቻ</b>\n` +
            `2️⃣ <b>30 ምርጥ የቪዲዮዎች ጥቅል (Videos Bundle)</b>\n` +
            `3️⃣ <b>ሁለቱንም በአንድ ላይ (መጽሐፍ + 30 ቪዲዮዎች)</b>\n` +
            `────────────────────\n\n` +
            `⚠️ <b>የአጠቃቀም መመሪያ፦</b>\n` +
            `• ከላይ ካሉት አማራጮች የፈለጉትን ለመምረጥ እና ትዕዛዝ ለመላክ ከታች በግራ በኩል ያለውን <b>'📚 order'</b> የሚለውን <b>Menu Button</b> ይጫኑ。\n\n` +
            `────────────────────\n\n` +
            `📚 <b>Welcome to The Negadras Bot, ${msg.from.first_name}!</b> 👋🌟\n\n` +
            `This bot is the official place to get <b>"The Negadras"</b> Trading Psychology E-Book & Premium Video Bundles by Natnael Biruk.\n\n` +
            `🔥 <b>Our Packages:</b>\n\n` +
            `1️⃣ <b>"The Negadras" Book (PDF)</b>\n` +
            `2️⃣ <b>30 Advanced Training Videos Bundle</b>\n` +
            `3️⃣ <b>Ultimate Combo (Book + 30 Videos Bundle)</b> <i>(Special Discount!)</i>\n\n` +
            `⚠️ <b>HOW TO BUY:</b>\n` +
            `• Please click the main <b>'📚 order'</b> (Menu Button) located at the bottom left of your screen.\n\n` +
            ` <b>© 2026 </b>\n` +
            `ነጋድራሱ ሜሌክ ENQOPAZYON`;

        await sendTelegram('sendMessage', {
            chat_id: chatId,
            text: welcomeText,
            parse_mode: "HTML",
            reply_markup: { remove_keyboard: true }
        });
    }

    // --- የአድሚን ኮማንዶች ---
    if (isAdmin) {
        
        if (text === "/users") {
            const userKeys = Object.keys(users);
            if (userKeys.length === 0) {
                await sendTelegram('sendMessage', { chat_id: chatId, text: "👥 እስካሁን የተመዘገበ ተጠቃሚ የለም。" });
            } else {
                let userListMsg = `👥 <b>የቦቱ ተጠቃሚዎች ዝርዝር (${userKeys.length})</b>\n\n`;
                userKeys.forEach((uid, index) => {
                    const uName = users[uid].name || "ስም የሌለው";
                    const uPackage = users[uid].purchased_package ? ` [🛍️ ${users[uid].purchased_package}]` : ""; 
                    const uUser = users[uid].username !== "N/A" ? `@${users[uid].username}` : "ዩዘርኔም የሌለው";
                    userListMsg += `${index + 1}. 👤 <b>${uName}</b>${uPackage} - ${uUser}\n🆔 <code>${uid}</code>\n────────────────────\n`;
                });
                await sendTelegram('sendMessage', { chat_id: chatId, text: userListMsg, parse_mode: "HTML" });
            }
        }

        else if (text.startsWith("/broadcast ")) {
            const broadcastMsg = text.replace("/broadcast ", "");
            if (GOOGLE_SHEET_URL) {
                try {
                    const response = await axios.get(GOOGLE_SHEET_URL);
                    const idsToBroadcast = response.data.ids || [];
                    let count = 0;
                    for (const uid of idsToBroadcast) {
                        if(uid && uid !== "N/A") {
                            await sendTelegram('sendMessage', { chat_id: uid, text: `📢 <b>ማስታወቂያ ከነጋድራሱ</b>\n\n${broadcastMsg}\n\nነጋድራሱ`, parse_mode: "HTML" });
                            count++;
                        }
                    }
                    await sendTelegram('sendMessage', { chat_id: chatId, text: `✅ መልእክቱ ለ ${count} ተጠቃሚዎች ተልኳል።` });
                } catch (err) {
                    await sendTelegram('sendMessage', { chat_id: chatId, text: `❌ የብሮድካስት ስህተት` });
                }
            }
        }

        else if (text.startsWith("/reply ")) {
            const parts = text.split(" ");
            const targetId = parts[1];
            let replyText = text.replace(`/reply ${targetId} `, "");
            
            let telegramName = "ተጠቃሚ";
            try {
                if (users[targetId] && users[targetId].name) telegramName = users[targetId].name;
            } catch (e) {}

            await sendTelegram('sendMessage', { chat_id: targetId, text: `📩 <b>ከነጋድራሱ የተላከ ምላሽ:</b>\n\n${replyText}\n\nነጋድራሱ`, parse_mode: "HTML" });
            
            await sendTelegram('sendMessage', { 
                chat_id: chatId, 
                text: `✅ ምላሹ ለደንበኛ <b>${telegramName}</b> (<code>${targetId}</code>) ተልኳል።`,
                parse_mode: "HTML" 
            });
        }

        else if (text === "/stats") {
            const total = Object.keys(users).length;
            await sendTelegram('sendMessage', { chat_id: chatId, text: `📊 <b>የቦቱ ስታቲስቲክስ:</b>\n\n👥 ጠቅላላ ተጠቃሚዎች: ${total}`, parse_mode: "HTML" });
        }

        // 📥 የፋይል መላኪያ
        else if (msg.document && msg.caption && msg.caption.startsWith("/sendfile ")) {
            const parts = msg.caption.trim().split(/\s+/);
            const targetId = parts[1];
            const inputPassword = parts[2]; 
            
            if (!targetId || !inputPassword) {
                await sendTelegram('sendMessage', { 
                    chat_id: chatId, 
                    text: `❌ <b>ስህተት!</b> እባክህ አጻጻፉን አስተካክል፦\n<code>/sendfile [ID] [ፓስወርድ]</code>` ,
                    parse_mode: "HTML"
                });
                return res.sendStatus(200);
            }

            let telegramName = "ተጠቃሚ";
            try {
                if (users[targetId] && users[targetId].name) telegramName = users[targetId].name;
            } catch (e) {}

            const warningMsg = `📩 <b>ከነጋድራሱ የተላከ መጽሐፍ:</b>\n\n` +
                `ስላዘዙ እናመሰግናለን! የ"ነጋድራሱ" መጽሐፍ (PDF)።\n\n` +
                `🔐 <b>የእርስዎ መክፈቻ ፓስወርድ (Password)፦</b> <code>${inputPassword}</code>\n\n` +
                `⚠️ <b>ማስጠንቀቂያ:</b> ይህ መጽሐፍ በባለቤትነት መብት የተጠበቀ እና የእርስዎ ስም እና ስልክ ቁጥር በፒዲኤፉ ውስጥ ተካቶ በፓስወርድ የተቆለፈ ነው። ለሌላ ሰው ማጋራት፣ ማሰራጨት ወይም መሸጥ በጥብቅ የተከለከለ እና በሕግም የሚያስቀጣ ይሆናል።\n\n` +
                `ነጋድራሱ`;
                
            await sendTelegram('sendDocument', {
                chat_id: targetId,
                document: msg.document.file_id,
                caption: warningMsg,
                parse_mode: "HTML"
            });
            
            await sendTelegram('sendMessage', { 
                chat_id: chatId, 
                text: `✅ ፋይሉ እና ፓስወርዱ [ <code>${inputPassword}</code> ] ለደንበኛ <b>${telegramName}</b> (<code>${targetId}</code>) ተልኳል።`,
                parse_mode: "HTML"
            });
        }
    } 
    else if (!text.startsWith("/")) {
        for (const adminId of ADMIN_IDS) {
            await sendTelegram('sendMessage', {
                chat_id: adminId,
                text: `📬 <b>አዲስ መልእክት ከደንበኛ!</b>\n\n` +
                      `👤 <b>የቴሌግራም ስም:</b> ${msg.from.first_name}\n` +
                      `✈️ <b>Username:</b> ${msg.from.username ? '@'+msg.from.username : "የለውም"}\n` +
                      `🆔 <b>ID:</b> <code>${userId}</code>\n\n` +
                      `💬 <b>መልእክት:</b> ${text}\n\n` +
                      `────────────────────\n` +
                      `📥 <b>ለ${msg.from.first_name} ምላሽ ለመስጠት፦</b>\n` +
                      `<code>/reply ${userId} 👋 ሰላም ${msg.from.first_name}፦ </code>`,
                parse_mode: "HTML"
            });
        }
        await sendTelegram('sendMessage', { chat_id: chatId, text: "መልእክትዎ ደርሷል! እናመሰግናለን。" });
    }

    res.sendStatus(200);
});

// 3. Webhook ለማገናኘት
app.get('/api/set-webhook', async (req, res) => {
    const webhookUrl = `${WEB_URL}/api/telegram-webhook`;
    const response = await axios.get(`https://api.telegram.org/bot${NEW_BOT_TOKEN}/setWebhook?url=${webhookUrl}`);
    res.json(response.data);
});

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// --- Keep-Alive Setup ---
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
