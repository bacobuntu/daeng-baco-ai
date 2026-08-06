require('dotenv').config();
const { startBaileys, getSock } = require('./baileys');
const express = require('express');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
app.use(express.json());
const PORT = process.env.PORT || 3000;

// ==========================================
// 1. PENGATURAN KUNCI (API KEYS)
// ==========================================
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// ==========================================
// 2. DATABASE SIMULASI (JADWAL HOME SERVICE)
// ==========================================
let jadwalTerapis = {
    "Rabu": ["09:00 (Pagi)", "13:00 (Siang)", "16:00 (Sore)"],
    "Kamis": ["09:00 (Pagi)", "16:00 (Sore)"],
    "Jumat": ["13:00 (Siang)", "16:00 (Sore)"]
};

let daftarOrder = [];

// ==========================================
// 3. FUNGSI-FUNGSI (TOOLS) UNTUK AI
// ==========================================

function cekJadwalKosong(hari) {
    console.log(`[SYSTEM] Mengecek slot Home Service untuk ${hari}...`);
    const jadwal = jadwalTerapis[hari];
    if (jadwal && jadwal.length > 0) {
        return { status: "tersedia", slot_kosong: jadwal };
    } else {
        return { status: "penuh", pesan: `Maaf, slot terapis keliling untuk hari ${hari} sudah penuh.` };
    }
}

function buatReservasiHomeService(namaPelanggan, nomorWA, hari, jam, alamat, layanan) {
    console.log(`[SYSTEM] Memproses pesanan dari ${namaPelanggan}...`);

    const jadwalHariItu = jadwalTerapis[hari];
    if (jadwalHariItu && jadwalHariItu.includes(jam)) {

        jadwalTerapis[hari] = jadwalHariItu.filter(j => j !== jam);
        const idPesanan = "HS-" + Math.floor(Math.random() * 10000);

        daftarOrder.push({
            id: idPesanan,
            nama: namaPelanggan,
            wa: nomorWA,
            hari: hari,
            jam: jam,
            alamat: alamat,
            layanan: layanan,
            status: "Menunggu Share Loc"
        });

        return {
            status: "sukses",
            id_pesanan: idPesanan,
            pesan: `Reservasi berhasil dicatat (ID: ${idPesanan})! Terapis akan datang pada ${hari} jam ${jam} untuk layanan ${layanan}. INSTRUKSI UNTUK AI: Beritahu pelanggan bahwa reservasi berhasil, LALU mintalah mereka mengirimkan 'Share Lokasi' (Share Loc) WhatsApp ke nomor ini agar terapis mudah menemukan rumahnya.`
        };
    } else {
        return {
            status: "gagal",
            pesan: `Slot jam ${jam} pada hari ${hari} baru saja dibooking orang lain. Arahkan untuk pilih jam lain.`
        };
    }
}

const geminiTools = [{
    functionDeclarations: [
        {
            name: "cek_jadwal_kosong",
            description: "Cek jadwal terapis yang tersedia pada hari tertentu.",
            parameters: {
                type: "object",
                properties: { hari: { type: "string" } },
                required: ["hari"]
            }
        },
        {
            name: "buat_reservasi_home_service",
            description: "Panggil ini JIKA SEMUA info terkumpul: Nama, Hari, Jam, Alamat Teks, dan Layanan.",
            parameters: {
                type: "object",
                properties: {
                    nama_pelanggan: { type: "string" },
                    hari: { type: "string" },
                    jam: { type: "string" },
                    alamat: { type: "string", description: "Alamat teks (misal: BTP Blok C)." },
                    layanan: { type: "string", description: "Jenis layanan (Recovery, Terapi Cedera, dll)." }
                },
                required: ["nama_pelanggan", "hari", "jam", "alamat", "layanan"]
            }
        }
    ]
}];

// ==========================================
// 4. LOGIKA AI (DAENG BACO)
// ==========================================

const DAFTAR_LAYANAN = `
1. Recovery (Pemulihan & Relaksasi rutin, untuk yang tidak ada keluhan sakit/cedera).
2. Terapi Cedera Olahraga (Keseleo, salah urat).
3. Terapi Saraf Kejepit (HNP).
4. Pijat Capek / Kebugaran.
`;

const SYSTEM_PROMPT = `
Kamu adalah Daeng Baco, asisten virtual khusus layanan Home Service (Klinik Terapi & Recovery) di Makassar.
Tugas utamamu membantu klien mengatur jadwal terapis ke rumah.

[ATURAN BAHASA]
Ramah, profesional, dan gunakan sapaan Makassar ("Tabe'", "Daeng", "Kak", "Puang").

[PILIHAN LAYANAN]
Kami memiliki beberapa layanan:
${DAFTAR_LAYANAN}
Jika pelanggan tidak menyebutkan keluhan, tanyakan apakah mereka butuh penanganan khusus atau sekadar "Recovery/Relaksasi". Jangan paksa mereka menyebutkan keluhan jika hanya butuh Recovery.

[SYARAT RESERVASI (WAJIB)]
Untuk memanggil fungsi buat_reservasi, kamu HARUS tahu:
1. Nama klien.
2. Hari (misal: Rabu).
3. Jam/Slot (sesuai ketersediaan).
4. Alamat Lengkap (Patokan teks).
5. Jenis Layanan (Berdasarkan daftar di atas atau keluhan mereka).

[ALUR PENTING SHARE LOKASI]
Setelah kamu berhasil membuat reservasi (fungsi buat_reservasi memberikan status 'sukses'), KAMU WAJIB meminta pelanggan untuk mengirimkan titik lokasi (Share Loc) melalui fitur lampiran lokasi WhatsApp, agar terapis tidak tersasar.

Saat ini adalah hari Selasa, 4 Agustus 2026.
`;

const model = genAI.getGenerativeModel({
    model: "gemini-3.5-flash",
    tools: geminiTools,
    systemInstruction: SYSTEM_PROMPT
});

const userSessions = new Map();

async function sendBaileysText(to, text) {
    try {
        const sock = getSock();
        if (sock) await sock.sendMessage(to, { text });
    } catch (e) { console.error("Gagal kirim pesan Baileys:", e.message); }
}

async function processMessage(senderPhone, messageObj, replyFn = sendBaileysText) {
    if (!userSessions.has(senderPhone)) {
        userSessions.set(senderPhone, []);
    }
    let history = userSessions.get(senderPhone);

    if (messageObj.type === 'location') {
        console.log(`[SYSTEM] Menerima Share Loc dari ${senderPhone}`);
        await replyFn(senderPhone, "Mantap Daeng! Titik lokasi ta' (Share Loc) sudah kami terima. Terapis kami akan segera meluncur sesuai jadwal. Terima kasih!");
        return;
    }

    if (messageObj.type === 'text') {
        const incomingText = messageObj.text.body;

        try {
            const chat = model.startChat({ history: history });
            let result = await chat.sendMessage(incomingText);
            let response = result.response;
            let functionCalls = response.functionCalls();

            while (functionCalls && functionCalls.length > 0) {
                const call = functionCalls[0];
                let functionResult = {};

                if (call.name === "cek_jadwal_kosong") {
                    functionResult = cekJadwalKosong(call.args.hari);
                } else if (call.name === "buat_reservasi_home_service") {
                    functionResult = buatReservasiHomeService(
                        call.args.nama_pelanggan,
                        senderPhone,
                        call.args.hari,
                        call.args.jam,
                        call.args.alamat,
                        call.args.layanan
                    );
                }

                result = await chat.sendMessage([{
                    functionResponse: { name: call.name, response: functionResult }
                }]);
                response = result.response;
                functionCalls = response.functionCalls();
            }

            const finalReply = response.text();
            userSessions.set(senderPhone, await chat.getHistory());

            await replyFn(senderPhone, finalReply);

        } catch (e) {
            console.error("Error AI:", e);
        }
    }
}

// ==========================================
// 5. WEBHOOK META (belum aktif, disiapkan untuk nanti)
// ==========================================
app.get('/webhook', (req, res) => {
    if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === process.env.VERIFY_TOKEN) {
        res.status(200).send(req.query['hub.challenge']);
    } else { res.sendStatus(403); }
});

app.post('/webhook', (req, res) => {
    res.sendStatus(200);
});

// ================================================
// 6. BAILEYS (WHATSAPP TESTING - HP ISTRI)
// ================================================
const QR_PASSWORD = process.env.QR_PASSWORD || 'gantidulu123';

app.get('/qr', (req, res) => {
    const pass = req.query.pass;
    if (pass !== QR_PASSWORD) {
        return res.status(401).send('<h2>Password salah. Tambahkan ?pass=passwordkamu di URL</h2>');
    }
    const { getQR, getStatus } = require('./baileys');
    const qr = getQR();
    const status = getStatus();
    if (status === 'connected') return res.send('<h2>Sudah terhubung ke WhatsApp!</h2>');
    if (!qr) return res.send('<h2>QR belum siap, refresh beberapa detik lagi</h2>');
    res.send(`<h2>Scan QR ini dari WhatsApp HP istri</h2><img src="${qr}" />`);
});

startBaileys((from, text, sock) => {
    processMessage(from, { type: 'text', text: { body: text } }, sendBaileysText);
});

app.listen(PORT, () => console.log(`🚀 Daeng Baco AI (Gemini Edition) aktif di port ${PORT}`));
