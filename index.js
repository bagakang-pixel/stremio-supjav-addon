// ============================================================
// Supjav Stremio Addon
// Mengambil data film dari https://supjav.com
// Menggunakan stremio-addon-sdk + axios + cheerio
// ============================================================

const { addonBuilder, serveHTTP } = require('stremio-addon-sdk');
const axios = require('axios');
const cheerio = require('cheerio');

// ------------------------------------------------------------
// Konfigurasi Dasar
// ------------------------------------------------------------
const BASE_URL = 'https://supjav.com';
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

// Instance axios dengan konfigurasi default
const http = axios.create({
  timeout: 20000,
  headers: {
    'User-Agent': USER_AGENT,
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9,id;q=0.8',
    Referer: BASE_URL + '/',
  },
});

// ============================================================
// MANIFEST ADDON
// ============================================================
const manifest = {
  id: 'com.supjav.addon',
  version: '1.0.0',
  name: 'Supjav Stremio Addon',
  description: 'Streaming video dari supjav',
  logo: 'https://supjav.com/favicon.ico',

  resources: ['catalog', 'meta', 'stream'],
  types: ['movie'],
  idPrefixes: ['supjav_'],

  catalogs: [
    {
      type: 'movie',
      id: 'supjav_latest',
      name: 'Supjav Terbaru',
      // Mendukung pencarian
      extra: [
        {
          name: 'search',
          isRequired: false,
        },
      ],
    },
  ],

  // Aktifkan pencarian di Stremio
  behaviorHints: {
    configurable: false,
  },
};

const builder = new addonBuilder(manifest);

// ============================================================
// UTILITAS
// ============================================================

/**
 * Normalisasi URL relatif menjadi absolut.
 * @param {string} href - URL dari atribut href/src.
 * @returns {string} URL absolut.
 */
function toAbsoluteUrl(href) {
  if (!href) return '';
  if (href.startsWith('http://') || href.startsWith('https://')) return href;
  if (href.startsWith('//')) return 'https:' + href;
  return BASE_URL + (href.startsWith('/') ? '' : '/') + href;
}

/**
 * Ekstrak ID unik supjav dari URL video.
 * Contoh: https://supjav.com/428838.html  ->  428838
 * @param {string} url - URL halaman video.
 * @returns {string|null} ID numerik atau null.
 */
function extractSupjavId(url) {
  if (!url) return null;
  // Cocokkan pola /{angka}.html atau /zh/{angka}.html dsb.
  const match = url.match(/\/(\d+)\.html/);
  return match ? match[1] : null;
}

/**
 * Ubah ID supjav menjadi format yang dikenali Stremio.
 * @param {string} rawId - ID numerik, mis. "428838".
 * @returns {string} ID ber-prefix, mis. "supjav_428838".
 */
function makeStremioId(rawId) {
  return `supjav_${rawId}`;
}

/**
 * Kembalikan ID numerik dari Stremio ID ber-prefix.
 * @param {string} stremioId - mis. "supjav_428838".
 * @returns {string} ID numerik, mis. "428838".
 */
function stripStremioId(stremioId) {
  return stremioId.replace(/^supjav_/, '');
}

/**
 * Deteksi kualitas video dari teks / URL.
 * @param {string} text - Teks yang mungkin mengandung resolusi.
 * @returns {string} Label kualitas, mis. "1080p".
 */
function detectQuality(text) {
  if (!text) return '';
  const lower = text.toLowerCase();
  if (lower.includes('2160') || lower.includes('4k')) return '2160p';
  if (lower.includes('1080')) return '1080p';
  if (lower.includes('720')) return '720p';
  if (lower.includes('480')) return '480p';
  if (lower.includes('360')) return '360p';
  return '';
}

// ============================================================
// SCRAPER: CATALOG & SEARCH
// ============================================================

/**
 * Scrape halaman daftar video (katalog utama atau hasil pencarian).
 *
 * Alur:
 *  1. Ambil HTML dari URL target.
 *  2. Muat ke cheerio.
 *  3. Pilih semua artikel post yang berisi link ke halaman video.
 *  4. Ekstrak ID, judul, dan thumbnail dari setiap post.
 *
 * @param {string} url - URL halaman yang akan di-scrape.
 * @returns {Promise<Array>} Array meta preview object untuk Stremio.
 */
async function scrapeCatalogPage(url) {
  const metas = [];

  try {
    const { data: html } = await http.get(url);
    const $ = cheerio.load(html);

    // Setiap item video biasanya berada di dalam <article> atau <div class="post">
    // dengan link ke halaman detail berakhiran .html
    $('article.post, div.post, div.post-item, .posts .post').each((_, el) => {
      const $el = $(el);

      // Cari link utama ke halaman video
      const linkEl = $el.find('a[href$=".html"]').first();
      if (!linkEl.length) return;

      const href = linkEl.attr('href');
      const rawId = extractSupjavId(href);
      if (!rawId) return;

      // Judul: ambil dari heading atau teks link
      let title =
        $el.find('h2, h3, .entry-title, .post-title').first().text().trim() ||
        linkEl.attr('title') ||
        linkEl.text().trim();

      if (!title) return;

      // Thumbnail: cari img di dalam post
      const imgEl = $el.find('img').first();
      let poster = imgEl.attr('src') || imgEl.attr('data-src') || '';
      poster = toAbsoluteUrl(poster);

      metas.push({
        id: makeStremioId(rawId),
        type: 'movie',
        name: title,
        poster,
        posterShape: 'poster',
      });
    });
  } catch (err) {
    console.error(`[Catalog] Gagal scrape ${url}:`, err.message);
  }

  return metas;
}

// ============================================================
// CATALOG HANDLER
// ============================================================
builder.defineCatalogHandler(async (args) => {
  const { type, id, extra } = args;

  // Hanya tangani tipe movie dan catalog kita
  if (type !== 'movie' || id !== 'supjav_latest') {
    return { metas: [] };
  }

  try {
    // --- Mode Pencarian ---
    if (extra && extra.search) {
      const query = encodeURIComponent(extra.search);
      const searchUrl = `${BASE_URL}/?s=${query}`;
      console.log(`[Catalog] Mencari: "${extra.search}" -> ${searchUrl}`);
      const metas = await scrapeCatalogPage(searchUrl);
      return { metas };
    }

    // --- Mode Katalog Utama (terbaru) ---
    // Supjav menampilkan video terbaru di halaman utama
    console.log(`[Catalog] Mengambil video terbaru dari ${BASE_URL}`);
    const metas = await scrapeCatalogPage(BASE_URL);

    // Batasi maksimal 100 item agar sesuai standar Stremio
    return { metas: metas.slice(0, 100) };
  } catch (err) {
    console.error('[Catalog] Error:', err.message);
    return { metas: [] };
  }
});

// ============================================================
// SCRAPER: META (DETAIL VIDEO)
// ============================================================

/**
 * Scrape halaman detail video untuk mengambil metadata lengkap.
 *
 * Selector yang digunakan (sesuai struktur HTML supjav):
 *  - Judul      : h1 di dalam .post-meta / tag h1
 *  - Deskripsi  : <meta name="description" content="...">
 *  - Poster     : <img class="img"> di dalam .post-meta.clearfix
 *                 atau background-image dari #player-wrap
 *  - Maker      : .cats > p > span "Maker :" -> <a>
 *  - Cast       : .cats > p > span "Cast :"  -> <a>
 *  - Tags       : semua <a> di dalam .tags
 *
 * @param {string} videoUrl - URL lengkap halaman video.
 * @returns {Promise<Object|null>} Meta object untuk Stremio.
 */
async function scrapeMetaPage(videoUrl) {
  try {
    const { data: html } = await http.get(videoUrl);
    const $ = cheerio.load(html);

    // --- Judul ---
    let title =
      $('.post-meta h1').first().text().trim() ||
      $('h1').first().text().trim() ||
      $('title').text().trim();

    // --- Deskripsi dari meta tag ---
    const description =
      $('meta[name="description"]').attr('content') || '';

    // --- Poster ---
    // Prioritas 1: img.img di dalam .post-meta
    let poster = $('.post-meta.clearfix img.img').attr('src') || '';

    // Prioritas 2: background-image dari #player-wrap
    if (!poster) {
      const bgStyle = $('#player-wrap').attr('style') || '';
      const bgMatch = bgStyle.match(/background-image\s*:\s*url\(['"]?(.*?)['"]?\)/);
      if (bgMatch) poster = bgMatch[1];
    }

    // Prioritas 3: img.img generik
    if (!poster) {
      poster = $('img.img').first().attr('src') || '';
    }

    poster = toAbsoluteUrl(poster);

    // --- Maker ---
    let maker = '';
    $('.cats p').each((_, el) => {
      const text = $(el).text();
      if (text.includes('Maker')) {
        maker = $(el).find('a').text().trim() || text.replace('Maker', '').replace(':', '').trim();
      }
    });

    // --- Cast ---
    let cast = '';
    $('.cats p').each((_, el) => {
      const text = $(el).text();
      if (text.includes('Cast')) {
        cast = $(el).find('a').text().trim() || text.replace('Cast', '').replace(':', '').trim();
      }
    });

    // --- Tags (Genre) ---
    const genres = [];
    $('.tags a').each((_, el) => {
      const tag = $(el).text().trim();
      if (tag) genres.push(tag);
    });

    // --- Susun meta object ---
    // Stremio tidak punya field khusus untuk "maker" / "cast",
    // jadi kita gabungkan ke dalam description agar tetap informatif.
    const extraInfo = [];
    if (maker) extraInfo.push(`Maker: ${maker}`);
    if (cast) extraInfo.push(`Cast: ${cast}`);

    const fullDescription = [
      description,
      extraInfo.length ? '\n\n' + extraInfo.join('\n') : '',
      genres.length ? '\n\nTags: ' + genres.join(', ') : '',
    ]
      .join('')
      .trim();

    return {
      id: makeStremioId(extractSupjavId(videoUrl)),
      type: 'movie',
      name: title,
      poster,
      posterShape: 'poster',
      background: poster, // gunakan poster sebagai background juga
      description: fullDescription || title,
      genres,
      // Stremio tidak punya field "cast"/"studio" native,
      // tapi beberapa klien membaca properti ini:
      cast: cast ? cast.split(',').map((s) => s.trim()) : [],
      studio: maker,
    };
  } catch (err) {
    console.error(`[Meta] Gagal scrape ${videoUrl}:`, err.message);
    return null;
  }
}

// ============================================================
// META HANDLER
// ============================================================
builder.defineMetaHandler(async (args) => {
  const { type, id } = args;

  if (type !== 'movie' || !id.startsWith('supjav_')) {
    return { meta: null };
  }

  const rawId = stripStremioId(id);
  const videoUrl = `${BASE_URL}/${rawId}.html`;
  console.log(`[Meta] Mengambil detail: ${videoUrl}`);

  try {
    const meta = await scrapeMetaPage(videoUrl);
    return { meta };
  } catch (err) {
    console.error('[Meta] Error:', err.message);
    return { meta: null };
  }
});

// ============================================================
// SCRAPER: STREAM (DECODING SERVER DATA-LINK)
// ============================================================

/**
 * ============================================================
 * PENJELASAN LOGIKA DECODING SERVER DATA-LINK
 * ============================================================
 *
 * Pada halaman detail supjav, terdapat bagian <div class="btns">
 * yang berisi tombol-tombol server:
 *
 *   <a href="javascript:;" class="btn-server active"
 *      data-link="[KODE_HASH]">FST</a>
 *   <a href="javascript:;" class="btn-server"
 *      data-link="[KODE_HASH]">VOE</a>
 *
 * Setiap tombol menyimpan "data-link" yang merupakan string hash
 * terenkripsi. Berdasarkan riset komunitas, untuk server tertentu
 * (terutama TV/FST) string tersebut perlu **dibalik urutannya**
 * (reverse string), lalu ditempelkan ke endpoint internal:
 *
 *   https://lk1.supremejav.com/supjav.php?c=<REVERSED_HASH>
 *
 * Hasil dari endpoint tersebut biasanya mengembalikan:
 *   - Sebuah iframe URL, atau
 *   - Langsung ke file .m3u8 / .mp4, atau
 *   - HTML yang berisi <source src="...">.
 *
 * Untuk server VOE, biasanya data-link langsung berupa kode
 * yang bisa dikonversi menjadi URL embed VOE, yang kemudian
 * di-resolve menjadi m3u8.
 *
 * Karena setiap server memiliki karakteristik berbeda, kita
 * mencoba beberapa strategi secara berurutan:
 *   1. Coba reverse + endpoint supremejav (untuk TV/FST).
 *   2. Coba decode base64 (beberapa server menggunakan ini).
 *   3. Coba gunakan data-link mentah sebagai URL (jika sudah URL).
 *
 * Setelah mendapatkan kandidat URL, kita periksa apakah URL
 * tersebut mengandung .m3u8 atau .mp4. Jika ya, kita
 * gunakan sebagai stream URL.
 * ============================================================
 */

/**
 * Coba decode data-link menjadi URL stream yang bisa diputar.
 *
 * @param {string} dataLink - Nilai atribut data-link dari tombol server.
 * @param {string} serverName - Nama server (mis. "FST", "VOE", "TV").
 * @returns {Promise<string|null>} URL stream atau null jika gagal.
 */
async function decodeDataLink(dataLink, serverName) {
  if (!dataLink) return null;

  // --- Strategi 1: Reverse string + endpoint supremejav ---
  // Beberapa server (terutama TV/FST) menggunakan hash yang
  // harus dibalik urutannya sebelum dikirim ke endpoint.
  try {
    const reversed = dataLink.split('').reverse().join('');
    const apiUrl = `https://lk1.supremejav.com/supjav.php?c=${reversed}`;

    console.log(`[Stream] [${serverName}] Mencoba reverse+API: ${apiUrl}`);

    const { data: apiResponse } = await http.get(apiUrl, {
      headers: {
        Referer: BASE_URL + '/',
        'User-Agent': USER_AGENT,
      },
    });

    // Jika response berupa string yang mengandung URL
    if (typeof apiResponse === 'string') {
      // Cari .m3u8 atau .mp4 di dalam response
      const m3u8Match = apiResponse.match(/https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*/);
      if (m3u8Match) return m3u8Match[0];

      const mp4Match = apiResponse.match(/https?:\/\/[^\s"'<>]+\.mp4[^\s"'<>]*/);
      if (mp4Match) return mp4Match[0];

      // Mungkin response berupa iframe src
      const iframeMatch = apiResponse.match(/src=["'](https?:\/\/[^"']+)["']/);
      if (iframeMatch) {
        // Coba resolve iframe ke m3u8
        const resolved = await resolveIframeToStream(iframeMatch[1]);
        if (resolved) return resolved;
      }
    }

    // Jika response berupa JSON
    if (apiResponse && typeof apiResponse === 'object') {
      const possibleUrl =
        apiResponse.url ||
        apiResponse.link ||
        apiResponse.src ||
        apiResponse.file ||
        apiResponse.data;
      if (typeof possibleUrl === 'string' && possibleUrl.startsWith('http')) {
        return possibleUrl;
      }
    }
  } catch (err) {
    console.log(`[Stream] [${serverName}] Strategi 1 gagal: ${err.message}`);
  }

  // --- Strategi 2: Base64 decode ---
  // Beberapa server menyimpan URL dalam bentuk base64.
  try {
    const decoded = Buffer.from(dataLink, 'base64').toString('utf-8');
    if (decoded.startsWith('http')) {
      console.log(`[Stream] [${serverName}] Base64 decode berhasil: ${decoded}`);
      // Jika URL adalah iframe, coba resolve
      if (decoded.includes('.m3u8') || decoded.includes('.mp4')) {
        return decoded;
      }
      const resolved = await resolveIframeToStream(decoded);
      if (resolved) return resolved;
    }
  } catch {
    // Bukan base64 valid, abaikan
  }

  // --- Strategi 3: Data-link sudah berupa URL langsung ---
  if (dataLink.startsWith('http')) {
    if (dataLink.includes('.m3u8') || dataLink.includes('.mp4')) {
      return dataLink;
    }
    const resolved = await resolveIframeToStream(dataLink);
    if (resolved) return resolved;
  }

  // --- Strategi 4: Coba akses data-link sebagai halaman web ---
  // Kadang data-link adalah path relatif atau ID yang perlu
  // diakses melalui endpoint tertentu.
  try {
    const directUrl = toAbsoluteUrl(dataLink);
    const { data: pageHtml } = await http.get(directUrl, {
      headers: { Referer: BASE_URL + '/' },
    });
    const $ = cheerio.load(pageHtml);

    // Cari source video di dalam halaman
    const sourceUrl =
      $('source[src]').first().attr('src') ||
      $('video[src]').first().attr('src') ||
      $('iframe[src]').first().attr('src');

    if (sourceUrl) {
      if (sourceUrl.includes('.m3u8') || sourceUrl.includes('.mp4')) {
        return sourceUrl;
      }
      const resolved = await resolveIframeToStream(sourceUrl);
      if (resolved) return resolved;
    }
  } catch {
    // Abaikan
  }

  return null;
}

/**
 * Resolve URL iframe (embed player) menjadi direct stream URL.
 * Beberapa server (VOE, dll.) menyematkan player dalam iframe
 * yang perlu di-fetch untuk menemukan .m3u8 di dalamnya.
 *
 * @param {string} iframeUrl - URL iframe player.
 * @returns {Promise<string|null>} Direct stream URL atau null.
 */
async function resolveIframeToStream(iframeUrl) {
  if (!iframeUrl || !iframeUrl.startsWith('http')) return null;

  try {
    const { data: html } = await http.get(iframeUrl, {
      headers: {
        Referer: BASE_URL + '/',
        'User-Agent': USER_AGENT,
      },
    });

    // Cari .m3u8 di dalam HTML iframe
    const m3u8Match = html.match(/https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*/);
    if (m3u8Match) return m3u8Match[0];

    const mp4Match = html.match(/https?:\/\/[^\s"'<>]+\.mp4[^\s"'<>]*/);
    if (mp4Match) return mp4Match[0];

    // Cari di dalam JavaScript (sering disembunyikan)
    const jsMatch = html.match(/["'](https?:\/\/[^"']+\.(?:m3u8|mp4)[^"']*)["']/);
    if (jsMatch) return jsMatch[1];

    // Cari source tag
    const $ = cheerio.load(html);
    const src =
      $('source[src]').first().attr('src') ||
      $('video[src]').first().attr('src');
    if (src) {
      if (src.includes('.m3u8') || src.includes('.mp4')) return src;
    }
  } catch {
    // Gagal fetch iframe
  }

  return null;
}

/**
 * Scrape semua tombol server dari halaman detail video,
 * decode setiap data-link, dan kembalikan daftar stream
 * yang sudah diurutkan berdasarkan kualitas.
 *
 * @param {string} videoUrl - URL halaman detail video.
 * @returns {Promise<Array>} Array stream object untuk Stremio.
 */
async function scrapeStreams(videoUrl) {
  const streams = [];

  try {
    const { data: html } = await http.get(videoUrl);
    const $ = cheerio.load(html);

    // Kumpulkan semua tombol server beserta data-link-nya
    const serverButtons = [];
    $('.btns .btn-server, .btn-server').each((_, el) => {
      const name = $(el).text().trim();
      const dataLink = $(el).attr('data-link');
      if (dataLink) {
        serverButtons.push({ name: name || 'Server', dataLink });
      }
    });

    console.log(`[Stream] Ditemukan ${serverButtons.length} server:`,
      serverButtons.map((s) => s.name).join(', '));

    // Proses setiap server secara paralel
    const results = await Promise.allSettled(
      serverButtons.map(async ({ name, dataLink }) => {
        const streamUrl = await decodeDataLink(dataLink, name);
        if (!streamUrl) return null;

        // Deteksi kualitas dari nama server atau URL
        const quality =
          detectQuality(name) ||
          detectQuality(streamUrl) ||
          '';

        return {
          name: 'Supjav',
          title: quality ? `${quality} - ${name}` : name,
          url: streamUrl,
          // Tandai apakah HLS agar Stremio bisa memutar dengan benar
          behaviorHints: {
            notWebReady: false,
            bingeGroup: 'supjav',
          },
        };
      })
    );

    // Ambil hasil yang berhasil saja
    for (const result of results) {
      if (result.status === 'fulfilled' && result.value) {
        streams.push(result.value);
      }
    }

    // -------------------------------------------------------
    // URUTKAN STREAM: kualitas tertinggi di index 0
    // Stremio akan otomatis memilih stream index 0 saat autoplay.
    // -------------------------------------------------------
    const qualityOrder = { '2160p': 4, '1080p': 3, '720p': 2, '480p': 1, '360p': 0 };
    streams.sort((a, b) => {
      const qa = detectQuality(a.title) || '';
      const qb = detectQuality(b.title) || '';
      return (qualityOrder[qb] || -1) - (qualityOrder[qa] || -1);
    });

    console.log(`[Stream] ${streams.length} stream berhasil di-resolve.`);
  } catch (err) {
    console.error(`[Stream] Gagal scrape ${videoUrl}:`, err.message);
  }

  return streams;
}

// ============================================================
// STREAM HANDLER
// ============================================================
builder.defineStreamHandler(async (args) => {
  const { type, id } = args;

  if (type !== 'movie' || !id.startsWith('supjav_')) {
    return { streams: [] };
  }

  const rawId = stripStremioId(id);
  const videoUrl = `${BASE_URL}/${rawId}.html`;
  console.log(`[Stream] Mencari stream untuk: ${videoUrl}`);

  try {
    const streams = await scrapeStreams(videoUrl);
    return { streams };
  } catch (err) {
    console.error('[Stream] Error:', err.message);
    return { streams: [] };
  }
});

// ============================================================
// JALANKAN SERVER
// ============================================================
const PORT = process.env.PORT || 7000;

serveHTTP(builder.getInterface(), {
  port: PORT,
  // Cache response selama 1 jam untuk mengurangi beban scraping
  cacheMaxAge: 3600,
}).then(({ url }) => {
  console.log('');
  console.log('========================================');
  console.log('  Supjav Stremio Addon sudah berjalan!');
  console.log('========================================');
  console.log(`  Manifest : ${url}/manifest.json`);
  console.log(`  Install  : stremio://install?url=${encodeURIComponent(url + '/manifest.json')}`);
  console.log(`  Lokal    : http://localhost:${PORT}/manifest.json`);
  console.log('========================================');
  console.log('');
}).catch((err) => {
  console.error('Gagal menjalankan server:', err);
  process.exit(1);
});