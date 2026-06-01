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
const OLD_BOT_TOKEN = process.env.OLD_BOT_TOKEN; 
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

// 🔐 በሙሉ ስም (የአባት ስም ጨምሮ) እና በስልክ ቁጥር ፓስወርድ የመፍጠሪያ ፈንክሽን
function generatePassword(name, phone) {
    let cleanName = name.trim().replace(/\s+/g, '_');
    let cleanPhone = phone.trim();
    return `${cleanName}@${cleanPhone}`; 
}

// ቴሌግрам መልእክት መላኪያ ፈንክሽን
async function sendTelegram(method, data, useOldBot = false) {
    try {
        const token = (useOldBot && OLD_BOT_TOKEN) ? OLD_BOT_TOKEN : NEW_BOT_TOKEN;
        return await axios.post(`https://api.telegram.org/bot${token}/${method}`, data);
    } catch (error) {
        console.error(`Telegram API Error (${method}):`, error.response ? error.response.data : error.message);
    }
}

// 🔄 የፓስወርድ መጥፋት ችግርን ለመፍታት ከ Google Sheet ላይ እውነተኛውን ፓስወርድ መፈለጊያ አዲስ ፈንክሽን
async function getPasswordFromSheet(targetUserId) {
    if (!GOOGLE_SHEET_URL) return null;
    try {
        const response = await axios.get(GOOGLE_SHEET_URL);
        
        let ordersArray = [];
        if (response.data) {
            if (Array.isArray(response.data.orders)) {
                ordersArray = response.data.orders;
            } else if (Array.isArray(response.data)) {
                ordersArray = response.data;
            }
        }

        if (ordersArray.length > 0) {
            // .slice().reverse() ኦሪጅናሉን ዳታ ሳይቀይር የቅርብ ጊዜውን ትዕዛዝ ቀድሞ ለመፈለግ ይረዳል
            const userOrder = ordersArray.slice().reverse().find(o => 
                (o.user_id && o.user_id.toString() === targetUserId.toString()) || 
                (o.userId && o.userId.toString() === targetUserId.toString())
            );
            
            if (userOrder) {
                return userOrder.customer_password || userOrder.customerPassword || null;
            }
        }
        return null;
    } catch (e) {
        console.error("❌ Error fetching password from Google Sheets:", e.message);
        return null;
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
            `🔐 <b>ለዚህ ደንበኛ በቋሚነት የተፈጠረ ፓስወርድ:</b> <code>${customerPassword}</code>\n\n` +
            `💬 <b>በአዲሱ ቦት ለመመለስ:</b> <code>/reply ${data.user_id} [መልእክት]</code>\n` +
            `💬 <b>በድሮው ቦት ለመመለስ:</b> <code>/reply ${data.user_id} old [መልእክት]</code>\n` +
            `📥 <b>ፋይል በአዲሱ ለመላክ:</b> Caption ላይ: <code>/sendfile ${data.user_id}</code>\n` +
            `📥 <b>ፋይል በድሮው ለመላክ:</b> Caption ላይ: <code>/sendfile ${data.user_id} old</code>`;

        for (const adminId of ADMIN_IDS) {
            await sendTelegram('sendPhoto', {
                chat_id: adminId,
                photo: data.receipt_url,
                caption: adminMsg,
                parse_mode: "HTML"
            }, false); 
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
            }, false); 
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
        }, false);
    }

    // --- የአድሚን ኮማንዶች ---
    if (isAdmin) {
        
        // 👥 የተጠቃሚዎችን ዝርዝር ለማየት (/users)
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

        // 📢 ብሮድካስት
        else if (text.startsWith("/broadcast ")) {
            const broadcastMsg = text.replace("/broadcast ", "");
            if (GOOGLE_SHEET_URL) {
                try {
                    const response = await axios.get(GOOGLE_SHEET_URL);
                    const idsToBroadcast = response.data.ids || [];
                    let count = 0;
                    for (const uid of idsToBroadcast) {
                        if(uid && uid !== "N/A") {
                            await sendTelegram('sendMessage', { chat_id: uid, text: `📢 <b>ማስታወቂያ ከነጋድራሱ</b>\n\n${broadcastMsg}\n\nነጋድራሱ`, parse_mode: "HTML" }, false);
                            if (OLD_BOT_TOKEN) {
                                await sendTelegram('sendMessage', { chat_id: uid, text: `📢 <b>ማስታወቂያ ከነጋድራሱ</b>\n\n${broadcastMsg}\n\nነጋድራሱ`, parse_mode: "HTML" }, true);
                            }
                            count++;
                        }
                    }
                    await sendTelegram('sendMessage', { chat_id: chatId, text: `✅ መልእክቱ ለ ${count} ተጠቃሚዎች ተልኳል።` });
                } catch (err) {
                    await sendTelegram('sendMessage', { chat_id: chatId, text: `❌ የብሮድካስት ስህተት` });
                }
            }
        }

        // 💬 ምላሽ መስጠት
        else if (text.startsWith("/reply ")) {
            const parts = text.split(" ");
            const targetId = parts[1];
            const useOld = parts[2] === "old";
            let replyText = useOld ? text.replace(`/reply ${targetId} old `, "") : text.replace(`/reply ${targetId} `, "");
            
            let telegramName = "ተጠቃሚ";
            
            try {
                const chatInfo = await sendTelegram('getChat', { chat_id: targetId }, useOld);
                if (chatInfo && chatInfo.data && chatInfo.data.result) {
                    telegramName = chatInfo.data.result.first_name;
                }
            } catch (e) {
                if (users[targetId] && users[targetId].name) telegramName = users[targetId].name;
            }

            await sendTelegram('sendMessage', { chat_id: targetId, text: `📩 <b>ከነጋድራሱ የተላከ ምላሽ:</b>\n\n${replyText}\n\nBuilt by : ነጋድራሱ ሜሌክ ENQOPAZYON`, parse_mode: "HTML" }, useOld);
            
            await sendTelegram('sendMessage', { 
                chat_id: chatId, 
                text: `✅ ምላሹ ለደንበኛ <b>${telegramName}</b> (<code>${targetId}</code>) በ${useOld ? 'ድሮው' : 'አዲሱ'} ቦት በኩል ተልኳል።`,
                parse_mode: "HTML" 
            });
        }

        // 📊 ስታቲስቲክስ (/stats)
        else if (text === "/stats") {
            const total = Object.keys(users).length;
            await sendTelegram('sendMessage', { chat_id: chatId, text: `📊 <b>የቦቱ ስታቲስቲክስ:</b>\n\n👥 ጠቅላላ ተጠቃሚዎች: ${total}`, parse_mode: "HTML" });
        }

        // 📥 ፋይል መላክ
        else if (msg.document && msg.caption && msg.caption.startsWith("/sendfile ")) {
            const parts = msg.caption.split(" ");
            const targetId = parts[1];
            const useOld = parts[2] === "old";
            
            let telegramName = "ተጠቃሚ";
            
            try {
                const chatInfo = await sendTelegram('getChat', { chat_id: targetId }, useOld);
                if (chatInfo && chatInfo.data && chatInfo.data.result) {
                    telegramName = chatInfo.data.result.first_name;
                }
            } catch (e) {
                if (users[targetId] && users[targetId].name) telegramName = users[targetId].name;
            }
            
            let finalPassword = null;
            
            // 🔍 ደረጃ 1፦ ከሎካል ፋይል መፈለግ
            if (users[targetId] && users[targetId].generated_password) {
                finalPassword = users[targetId].generated_password;
            }
            
            // 🔍 ደረጃ 2፦ ከ Google Sheet መፈለግ (የተስተካከለው ክፍል)
            if (!finalPassword) {
                finalPassword = await getPasswordFromSheet(targetId);
            }
            
            // 🔍 ደረጃ 3፦ ከጠፋ የመጨረሻ አማራጭ ከ ID ቁጥር ማመንጨት
            if (!finalPassword) {
                const lastFourId = targetId.substring(targetId.length - 4);
                finalPassword = `CUSTOMER@${lastFourId}`; 
            }

            const warningMsg = `📩 <b>ከነጋድራሱ የተላከ መጽሐፍ:</b>\n\n` +
                `ስላዘዙ እናመሰግናለን! የ"ነጋድራሱ" መጽሐፍ (PDF)።\n\n` +
                `🔐 <b>የእርስዎ መክፈቻ ፓስወርድ (Password)፦</b> <code>${finalPassword}</code>\n\n` +
                `⚠️ <b>ማስጠንቀቂያ:</b> ይህ መጽሐፍ በባለቤትነት መብት የተጠበቀ እና የእርስዎ ስም እና ስልክ ቁጥር በፒዲኤፉ ውስጥ ተካቶ በፓስወርድ የተቆለፈ ነው። ለሌላ ሰው ማጋራት፣ ማሰራጨት ወይም መሸጥ በጥብቅ የተከለከለ እና በሕግ ያስቀጣል።\n\n` +
                `ነጋድራሱ`;
                
            await sendTelegram('sendDocument', {
                chat_id: targetId,
                document: msg.document.file_id,
                caption: warningMsg,
                parse_mode: "HTML"
            }, useOld);
            
            await sendTelegram('sendMessage', { 
                chat_id: chatId, 
                text: `✅ ፋይሉ እና ፓስወርዱ [ <code>${finalPassword}</code> ] ለደንበኛ <b>${telegramName}</b> (<code>${targetId}</code>) በ<b>${useOld ? 'ድሮው' : 'አዲሱ'}</b> ቦት በኩል ተልኳል።`,
                parse_mode: "HTML"
            });
        }
    } 
    // ተራ መልእክት ከደንበኛ
    else if (!text.startsWith("/")) {
        for (const adminId of ADMIN_IDS) {
            await sendTelegram('sendMessage', {
                chat_id: adminId,
                text: `📬 <b>መልእክት ከደንበኛ:</b>\n\n👤 <b>የቴሌግራም ስም:</b> ${msg.from.first_name}\n🆔 ID: <code>${userId}</code>\n\n💬 መልእክት: ${text}`,
                parse_mode: "HTML"
            }, false);
        }
        await sendTelegram('sendMessage', { chat_id: chatId, text: "መልእክትዎ ደርሷል! እናመሰግናለን。" }, false);
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
