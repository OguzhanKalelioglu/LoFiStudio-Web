// LoFiStudio Web Player Application Controller

// 1. Configuration & Constants
const SUPABASE_URL = "https://svigwxofgvzpdwzdeiur.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_Yg9_yPkeenZjYK2rEcrTUw_b4QYkGJa";
const DEFAULT_ARTWORK_BASE = "https://cdn.lofistudio.app/artwork";

// 2. State Management
let supabaseClient = null;
let catalog = {
    categories: [],
    homeSections: [],
    artworkBaseURL: DEFAULT_ARTWORK_BASE
};
let favorites = []; // Track IDs
let activeView = "discover"; // discover, categories, favorites
let currentPlaylist = null;
let playQueue = [];
let queueIndex = -1;
let currentTrack = null;
let isPlaying = false;
let isShuffle = false;
let isRepeat = false;
let isMuted = false;
let activeVolume = 0.8;
let lastPlayedTrackId = null;

// DOM Elements
let audioEl = null;
let timelineFill = null;
let timelineThumb = null;
let timelineSlider = null;
let volumeFill = null;
let volumeThumb = null;
let volumeSlider = null;
let playBtn = null;
let playIcon = null;
let timeCurrent = null;
let timeTotal = null;

// Language System
function initLanguage() {
    const supportedLangs = ["de", "en", "es", "fr", "it", "ja", "ko", "pt-BR", "tr"];
    let lang = localStorage.getItem("lofistudio_lang");
    
    if (!lang) {
        // Auto detect browser language
        const userLang = navigator.language || (navigator.languages && navigator.languages[0]) || "";
        if (supportedLangs.includes(userLang)) {
            lang = userLang;
        } else {
            const prefix = userLang.split('-')[0];
            if (prefix === "pt") {
                lang = "pt-BR";
            } else if (supportedLangs.includes(prefix)) {
                lang = prefix;
            } else {
                lang = "en"; // Default fallback
            }
        }
    }
    
    setLanguage(lang, false);
}

function setLanguage(lang, shouldRender = true) {
    currentLang = lang;
    localStorage.setItem("lofistudio_lang", lang);
    document.documentElement.setAttribute("lang", lang);
    
    // Update dropdown value
    const select = document.getElementById("lang-select");
    if (select) select.value = lang;
    
    // Apply translations
    updateStaticTranslations();
    
    if (shouldRender) {
        renderApp();
        updateHeaderStatusDate();
        if (currentPlaylist) {
            let categoryMatch = null;
            for (const cat of catalog.categories) {
                if (cat.playlists.some(p => p.id === currentPlaylist.id)) {
                    categoryMatch = cat;
                    break;
                }
            }
            if (categoryMatch) {
                openPlaylistModal(currentPlaylist, categoryMatch);
            }
        }
    }
}

function updateHeaderStatusDate() {
    const dateEl = document.getElementById("header-status");
    if (dateEl) {
        const today = new Date();
        const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
        
        let localeCode = "en-US";
        if (currentLang === "tr") localeCode = "tr-TR";
        else if (currentLang === "de") localeCode = "de-DE";
        else if (currentLang === "es") localeCode = "es-ES";
        else if (currentLang === "fr") localeCode = "fr-FR";
        else if (currentLang === "it") localeCode = "it-IT";
        else if (currentLang === "ja") localeCode = "ja-JP";
        else if (currentLang === "ko") localeCode = "ko-KR";
        else if (currentLang === "pt-BR") localeCode = "pt-BR";
        
        dateEl.textContent = `// ${today.toLocaleDateString(localeCode, options).toLowerCase()}.`;
    }
}

function updateStaticTranslations() {
    document.querySelectorAll("[data-i18n]").forEach(el => {
        const key = el.getAttribute("data-i18n");
        el.textContent = getTranslation(key);
    });
    
    document.querySelectorAll("[data-i18n-placeholder]").forEach(el => {
        const key = el.getAttribute("data-i18n-placeholder");
        el.setAttribute("placeholder", getTranslation(key));
    });
    
    document.querySelectorAll("[data-i18n-title]").forEach(el => {
        const key = el.getAttribute("data-i18n-title");
        el.setAttribute("title", getTranslation(key));
    });
    
    document.title = getTranslation("page_title");
    const descMeta = document.querySelector('meta[name="description"]');
    if (descMeta) descMeta.setAttribute("content", getTranslation("meta_description"));
    
    const ogTitle = document.querySelector('meta[property="og:title"]');
    if (ogTitle) ogTitle.setAttribute("content", getTranslation("page_title"));
    
    const ogDesc = document.querySelector('meta[property="og:description"]');
    if (ogDesc) ogDesc.setAttribute("content", getTranslation("meta_description"));
}

// Initialize Application
document.addEventListener("DOMContentLoaded", async () => {
    initDOMElements();
    loadLocalStorage();
    initLanguage();
    initSupabase();
    initAudioEngine();
    setupEventHandlers();
    
    await fetchCatalog();
    renderApp();
    restoreLastSession();
});

// Setup DOM References
function initDOMElements() {
    audioEl = document.getElementById("html5-audio");
    timelineFill = document.getElementById("timeline-fill");
    timelineThumb = document.getElementById("timeline-thumb");
    timelineSlider = document.getElementById("timeline-slider");
    volumeFill = document.getElementById("volume-fill");
    volumeThumb = document.getElementById("volume-thumb");
    volumeSlider = document.getElementById("volume-slider");
    playBtn = document.getElementById("player-btn-play");
    playIcon = document.getElementById("player-play-icon");
    timeCurrent = document.getElementById("player-time-current");
    timeTotal = document.getElementById("player-time-total");
    
    // Set initial date in footer
    updateHeaderStatusDate();
}

// Load settings from localStorage
function loadLocalStorage() {
    try {
        const storedFavs = localStorage.getItem("lofistudio_favorites");
        if (storedFavs) favorites = JSON.parse(storedFavs);
        
        const storedVol = localStorage.getItem("lofistudio_volume");
        if (storedVol) activeVolume = parseFloat(storedVol);
        
        const storedMute = localStorage.getItem("lofistudio_mute");
        if (storedMute) isMuted = storedMute === "true";

        const storedShuffle = localStorage.getItem("lofistudio_shuffle");
        if (storedShuffle) isShuffle = storedShuffle === "true";

        const storedRepeat = localStorage.getItem("lofistudio_repeat");
        if (storedRepeat) isRepeat = storedRepeat === "true";
        
        lastPlayedTrackId = localStorage.getItem("lofistudio_last_track_id");
    } catch (e) {
        console.error("Local storage error:", e);
    }
}

// Initialize Supabase SDK Client
function initSupabase() {
    if (typeof supabase !== "undefined") {
        supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    } else {
        console.error("Supabase script CDN failed to load.");
        showNotification(getTranslation("notif_supabase_error"), "error");
    }
}

// Fetch Catalog Data from Supabase RPC
async function fetchCatalog() {
    setHeaderStatus(getTranslation("status_loading"));
    try {
        if (!supabaseClient) throw new Error("Supabase client uninitialized");
        
        const { data, error } = await supabaseClient.rpc("get_catalog");
        if (error) throw error;
        
        catalog.categories = data.categories || [];
        catalog.homeSections = data.homeSections || [];
        catalog.artworkBaseURL = data.artworkBaseURL || DEFAULT_ARTWORK_BASE;
        
        setHeaderStatus(getTranslation("status_ready"));
    } catch (e) {
        console.error("Fetch catalog failed:", e);
        setHeaderStatus(getTranslation("status_catalog_failed"));
        showNotification(getTranslation("notif_catalog_error"), "error");
    }
}

function setHeaderStatus(status) {
    const el = document.getElementById("header-status");
    if (el) el.textContent = `// ${status}`;
}

// Render dynamic components
function renderApp() {
    renderDiscover();
    renderCategoriesPanel();
    renderFavoritesPanel();
    updateNavigationUI();
}

// 3. UI RENDERING LOGIC

// Render Keşfet (Ana Sayfa) View
function renderDiscover() {
    // A. Render Carousel (Featured Playlists)
    const featuredPlaylists = [];
    catalog.categories.forEach(cat => {
        const featured = cat.playlists.find(p => p.featured);
        if (featured) {
            featuredPlaylists.push({ playlist: featured, category: cat });
        }
    });
    
    const carouselSection = document.getElementById("featured-section");
    const carouselTrack = document.getElementById("carousel-track-el");
    const carouselDots = document.getElementById("carousel-dots-el");
    
    if (featuredPlaylists.length > 0 && carouselTrack && carouselDots) {
        carouselSection.style.display = "block";
        carouselTrack.innerHTML = "";
        carouselDots.innerHTML = "";
        
        featuredPlaylists.forEach((item, index) => {
            const slide = document.createElement("div");
            slide.className = `carousel-slide ${index === 0 ? 'active' : ''}`;
            const artworkUrl = getArtworkUrl(item.playlist.artworkName);
            slide.style.backgroundImage = `url('${artworkUrl}')`;
            slide.onclick = () => openPlaylistModal(item.playlist, item.category);
            
            slide.innerHTML = `
                <div class="carousel-content">
                    <span class="carousel-badge" style="background-color: ${item.category.accentHex || 'var(--primary)'}">${item.category.title}</span>
                    <h2 class="carousel-title">${item.playlist.title}</h2>
                    <p class="carousel-subtitle">${getResolvedSubtitle(item.playlist)}</p>
                    <button class="carousel-btn">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                        ${getTranslation("Play Now")}
                    </button>
                </div>
            `;
            carouselTrack.appendChild(slide);
            
            const dot = document.createElement("button");
            dot.className = `carousel-dot ${index === 0 ? 'active' : ''}`;
            dot.onclick = (e) => {
                e.stopPropagation();
                setCarouselSlide(index);
            };
            carouselDots.appendChild(dot);
        });
        
        // Start automatic carousel scrolling
        initCarouselAutoScroll(featuredPlaylists.length);
    } else if (carouselSection) {
        carouselSection.style.display = "none";
    }

    // B. Today Shelf (For Today Section Items)
    const todayGrid = document.getElementById("today-playlists-grid");
    if (todayGrid) {
        todayGrid.innerHTML = "";
        const todaySection = catalog.homeSections.find(s => s.id === "today");
        if (todaySection && todaySection.items.length > 0) {
            todaySection.items.forEach(item => {
                // Find playlist details in catalog
                let playlistMatch = null;
                let categoryMatch = null;
                
                for (const cat of catalog.categories) {
                    const match = cat.playlists.find(p => p.id === item.playlistId);
                    if (match) {
                        playlistMatch = match;
                        categoryMatch = cat;
                        break;
                    }
                }
                
                if (playlistMatch) {
                    const card = createPlaylistCard(playlistMatch, categoryMatch);
                    todayGrid.appendChild(card);
                }
            });
        } else {
            // Fallback to first few playlists if no homeSection items found
            let count = 0;
            for (const cat of catalog.categories) {
                for (const p of cat.playlists) {
                    if (count < 6) {
                        todayGrid.appendChild(createPlaylistCard(p, cat));
                        count++;
                    }
                }
            }
        }
    }

    // C. Discover Categories Preview
    const discCatGrid = document.getElementById("discover-categories-grid");
    if (discCatGrid) {
        discCatGrid.innerHTML = "";
        catalog.categories.slice(0, 4).forEach(cat => {
            const card = createCategoryCard(cat);
            discCatGrid.appendChild(card);
        });
    }
}

// Render Categoriler View
function renderCategoriesPanel() {
    const allCatGrid = document.getElementById("all-categories-grid");
    if (allCatGrid) {
        allCatGrid.innerHTML = "";
        catalog.categories.forEach(cat => {
            allCatGrid.appendChild(createCategoryCard(cat));
        });
    }

    const allPlaylistsGrid = document.getElementById("all-playlists-grid");
    if (allPlaylistsGrid) {
        allPlaylistsGrid.innerHTML = "";
        catalog.categories.forEach(cat => {
            cat.playlists.forEach(playlist => {
                allPlaylistsGrid.appendChild(createPlaylistCard(playlist, cat));
            });
        });
    }
}

// Render Favorites View
function renderFavoritesPanel() {
    const listEl = document.getElementById("favorites-tracks-list");
    const countEl = document.getElementById("favorites-count");
    if (!listEl) return;
    
    const favTracks = [];
    
    // Scan catalog to resolve metadata for favorite track IDs
    catalog.categories.forEach(cat => {
        cat.playlists.forEach(p => {
            p.tracks.forEach(t => {
                if (favorites.includes(t.id) && !favTracks.some(ft => ft.id === t.id)) {
                    favTracks.push({ track: t, playlist: p, category: cat });
                }
            });
        });
    });
    
    if (countEl) countEl.textContent = `// ${getTranslation("tracks_count_suffix", { count: favTracks.length })}`;
    
    if (favTracks.length > 0) {
        listEl.innerHTML = "";
        favTracks.forEach((item, index) => {
            const row = createTrackRow(item.track, index + 1, item.playlist, favTracks.map(ft => ft.track));
            listEl.appendChild(row);
        });
    } else {
        listEl.innerHTML = `
            <div style="text-align: center; padding: 4rem; color: var(--text-muted);" data-i18n="no_favorites_text">
                ${getTranslation("no_favorites_text")}
            </div>
        `;
    }
}

// Helper to resolve artwork CDN URLs
function getArtworkUrl(name) {
    if (!name) return "https://fav.farm/🎧";
    // Avoid double png extensions if database returned artwork_name ending in png
    const cleanName = name.replace(/\.png$/i, "");
    return `${catalog.artworkBaseURL}/${cleanName}.png`;
}

// Helper to create Playlist Card element
function createPlaylistCard(playlist, category) {
    const el = document.createElement("div");
    el.className = "playlist-card";
    el.onclick = () => openPlaylistModal(playlist, category);
    
    const artworkUrl = getArtworkUrl(playlist.artworkName || category.artworkName);
    
    el.innerHTML = `
        <div class="playlist-card-img-wrapper">
            <img src="${artworkUrl}" class="playlist-card-img" alt="${playlist.title}" loading="lazy">
            <button class="playlist-card-play-btn" title="${getTranslation("btn_play")}">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
            </button>
        </div>
        <h4 class="playlist-card-title">${playlist.title}</h4>
        <p class="playlist-card-subtitle">${getResolvedSubtitle(playlist)}</p>
    `;
    
    // Intercept card play button click
    const playBtn = el.querySelector(".playlist-card-play-btn");
    playBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (playlist.tracks.length > 0) {
            playTrackList(playlist.tracks, 0, playlist);
        } else {
            showNotification(getTranslation("notif_empty_playlist"), "warning");
        }
    });
    
    return el;
}

// Helper to create Category Card element
function createCategoryCard(category) {
    const el = document.createElement("div");
    el.className = "category-card";
    el.onclick = () => {
        // Go to Categories view and scroll to categories shelf
        switchView("categories");
        setTimeout(() => {
            const shelf = document.getElementById("all-playlists-grid");
            if (shelf) shelf.scrollIntoView({ behavior: "smooth" });
        }, 100);
    };
    
    const artworkUrl = getArtworkUrl(category.artworkName);
    
    el.innerHTML = `
        <div class="category-card-bg" style="background-image: url('${artworkUrl}')"></div>
        <div class="category-card-content">
            <span class="category-card-badge" style="background-color: ${category.accentHex || 'var(--primary)'}">${getTranslation("category_card_badge")}</span>
            <h4 class="category-card-title">${category.title}</h4>
            <p class="category-card-subtitle">${category.mood}</p>
        </div>
    `;
    return el;
}

// Helper to create Track Row in listings
function createTrackRow(track, index, playlist, queueSourceList) {
    const row = document.createElement("div");
    row.className = `track-row ${currentTrack && currentTrack.id === track.id ? "active" : ""}`;
    
    const isFav = favorites.includes(track.id);
    
    row.innerHTML = `
        <div class="track-row-num">${index}</div>
        <div class="track-row-info">
            <div class="track-row-title">${track.title}</div>
            <div class="track-row-artist">${track.artist || "LoFiStudio"}</div>
        </div>
        <div class="track-row-dur">${formatDuration(track.duration)}</div>
        <button class="track-row-action ${isFav ? 'favorited' : ''}" title="${isFav ? getTranslation("track_row_unlike") : getTranslation("track_row_like")}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="${isFav ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></svg>
        </button>
    `;
    
    row.onclick = () => {
        playTrackList(queueSourceList, index - 1, playlist);
    };
    
    const favBtn = row.querySelector(".track-row-action");
    favBtn.onclick = (e) => {
        e.stopPropagation();
        toggleFavorite(track.id);
        favBtn.classList.toggle("favorited");
        
        // Redraw SVG fill
        const path = favBtn.querySelector("svg");
        const isNowFav = favorites.includes(track.id);
        path.setAttribute("fill", isNowFav ? "currentColor" : "none");
        
        // Re-render other views if favorites view is open
        if (activeView === "favorites") {
            renderFavoritesPanel();
        }
    };
    
    return row;
}

// Carousel Autoplay Support
let carouselInterval = null;
let carouselCurrentIndex = 0;
function initCarouselAutoScroll(slidesCount) {
    if (carouselInterval) clearInterval(carouselInterval);
    carouselCurrentIndex = 0;
    
    carouselInterval = setInterval(() => {
        carouselCurrentIndex = (carouselCurrentIndex + 1) % slidesCount;
        setCarouselSlide(carouselCurrentIndex);
    }, 6000);
}

function setCarouselSlide(index) {
    carouselCurrentIndex = index;
    const track = document.getElementById("carousel-track-el");
    const dots = document.querySelectorAll(".carousel-dot");
    
    if (track) {
        track.style.transform = `translateX(-${index * 100}%)`;
    }
    
    dots.forEach((dot, idx) => {
        dot.classList.toggle("active", idx === index);
    });
}

// Playlists details Modal Panel Drawer
function openPlaylistModal(playlist, category) {
    currentPlaylist = playlist;
    const modal = document.getElementById("playlist-modal-el");
    const overlay = document.getElementById("modal-overlay-el");
    
    const artworkUrl = getArtworkUrl(playlist.artworkName || category.artworkName);
    
    // Set metadata
    document.getElementById("detail-artwork-img").src = artworkUrl;
    document.getElementById("detail-playlist-title").textContent = playlist.title;
    document.getElementById("detail-playlist-desc").textContent = getResolvedSubtitle(playlist);
    
    const badge = document.getElementById("detail-category-badge");
    badge.textContent = category.title;
    badge.style.backgroundColor = category.accentHex || "var(--primary)";
    
    // Render tracks
    const tracksContainer = document.getElementById("detail-tracks-list");
    tracksContainer.innerHTML = "";
    
    if (playlist.tracks && playlist.tracks.length > 0) {
        playlist.tracks.forEach((track, index) => {
            const row = createTrackRow(track, index + 1, playlist, playlist.tracks);
            tracksContainer.appendChild(row);
        });
    } else {
        tracksContainer.innerHTML = `
            <div style="text-align: center; padding: 2rem; color: var(--text-muted);" data-i18n="empty_playlist_text">
                ${getTranslation("empty_playlist_text")}
            </div>
        `;
    }
    
    // Bind Play All action button
    document.getElementById("detail-play-btn").onclick = () => {
        if (playlist.tracks && playlist.tracks.length > 0) {
            playTrackList(playlist.tracks, 0, playlist);
        }
    };
    
    // Show drawer
    modal.classList.add("open");
    overlay.classList.add("active");
}

function closePlaylistModal() {
    const modal = document.getElementById("playlist-modal-el");
    const overlay = document.getElementById("modal-overlay-el");
    
    if (modal) modal.classList.remove("open");
    if (overlay) overlay.classList.remove("active");
    currentPlaylist = null;
}

// View switcher tabs
function switchView(viewName) {
    activeView = viewName;
    
    const panels = {
        discover: document.getElementById("view-discover-panel"),
        categories: document.getElementById("view-categories-panel"),
        favorites: document.getElementById("view-favorites-panel")
    };
    
    Object.keys(panels).forEach(key => {
        if (panels[key]) {
            panels[key].style.display = key === viewName ? "block" : "none";
        }
    });
    
    // Scroll content panel to top
    const scrollEl = document.getElementById("main-content-scroll");
    if (scrollEl) scrollEl.scrollTop = 0;
    
    if (viewName === "favorites") {
        renderFavoritesPanel();
    }
    
    updateNavigationUI();
}

function updateNavigationUI() {
    // Desktop Nav Items
    const desktopItems = {
        discover: document.getElementById("nav-discover"),
        categories: document.getElementById("nav-categories"),
        favorites: document.getElementById("nav-favorites")
    };
    
    // Mobile Nav Items
    const mobileItems = {
        discover: document.getElementById("mob-nav-discover"),
        categories: document.getElementById("mob-nav-categories"),
        favorites: document.getElementById("mob-nav-favorites")
    };
    
    Object.keys(desktopItems).forEach(key => {
        if (desktopItems[key]) desktopItems[key].classList.toggle("active", key === activeView);
    });
    
    Object.keys(mobileItems).forEach(key => {
        if (mobileItems[key]) mobileItems[key].classList.toggle("active", key === activeView);
    });
}

// 4. AUDIO ENGINE & PLAYBACK CONTROLLER

function initAudioEngine() {
    if (!audioEl) return;
    
    // Set initial volumes
    audioEl.volume = isMuted ? 0 : activeVolume;
    updateVolumeSliderUI();
    
    // Audio engine event bindings
    audioEl.addEventListener("timeupdate", () => {
        updateProgressUI();
    });
    
    audioEl.addEventListener("durationchange", () => {
        if (timeTotal && audioEl.duration) {
            timeTotal.textContent = formatDuration(audioEl.duration);
        }
    });
    
    audioEl.addEventListener("ended", () => {
        handleTrackEnded();
    });
    
    audioEl.addEventListener("error", (e) => {
        console.error("Audio playback error:", e);
        setHeaderStatus(getTranslation("status_playback_error"));
        showNotification(getTranslation("notif_playback_error"), "error");
        setIsPlaying(false);
    });
}

// Play a selected queue source
function playTrackList(tracks, index, playlistContext) {
    if (!tracks || tracks.length === 0) return;
    
    currentPlaylist = playlistContext;
    playQueue = [...tracks];
    queueIndex = index;
    
    playCurrentQueueIndex();
}

async function playCurrentQueueIndex() {
    if (queueIndex < 0 || queueIndex >= playQueue.length) return;
    
    const track = playQueue[queueIndex];
    currentTrack = track;
    
    // Sync UI active rows
    updateActiveRowsUI();
    updatePlayerMetaUI();
    
    setIsPlaying(false);
    setHeaderStatus(getTranslation("status_loading_track", { title: track.title.toLowerCase() }));
    
    try {
        if (!supabaseClient) throw new Error("Supabase is not initialized");
        
        // Fetch signed playback R2 URL via Edge Function
        const { data, error } = await supabaseClient.functions.invoke("playback-url", {
            body: { assetKey: track.assetKey }
        });
        
        if (error) throw error;
        if (!data || !data.url) throw new Error("Signed URL not returned");
        
        // Set Audio source & Play
        audioEl.src = data.url;
        audioEl.load();
        
        await audioEl.play();
        setIsPlaying(true);
        setHeaderStatus(getTranslation("status_playing_track", { title: track.title.toLowerCase() }));
        
        // Store session state
        localStorage.setItem("lofistudio_last_track_id", track.id);
        
    } catch (e) {
        console.error("Failed to load playback link:", e);
        setHeaderStatus(getTranslation("status_playback_failed"));
        showNotification(getTranslation("notif_asset_error", { title: track.title }), "error");
        setIsPlaying(false);
    }
}

function handleTrackEnded() {
    if (isRepeat) {
        // Replay same track
        audioEl.currentTime = 0;
        audioEl.play();
    } else {
        // Go next
        playNextTrack();
    }
}

function playNextTrack() {
    if (playQueue.length === 0) return;
    
    if (isShuffle) {
        // Random pick
        queueIndex = Math.floor(Math.random() * playQueue.length);
    } else {
        // Linear next
        queueIndex = (queueIndex + 1) % playQueue.length;
    }
    
    playCurrentQueueIndex();
}

function playPrevTrack() {
    if (playQueue.length === 0) return;
    
    if (audioEl.currentTime > 5) {
        // Reset current track if played past 5s
        audioEl.currentTime = 0;
        updateProgressUI();
    } else {
        // Go previous
        queueIndex = queueIndex - 1 < 0 ? playQueue.length - 1 : queueIndex - 1;
        playCurrentQueueIndex();
    }
}

function togglePlay() {
    if (!currentTrack) {
        // Fallback: Play first playlist in list
        playFirstPlaylistTrack();
        return;
    }
    
    if (isPlaying) {
        audioEl.pause();
        setIsPlaying(false);
        setHeaderStatus(getTranslation("status_paused"));
    } else {
        audioEl.play()
            .then(() => {
                setIsPlaying(true);
                setHeaderStatus(getTranslation("status_playing_track", { title: currentTrack.title.toLowerCase() }));
            })
            .catch(e => {
                console.error("Playback restart failed:", e);
            });
    }
}

function playFirstPlaylistTrack() {
    if (catalog.categories.length > 0) {
        const cat = catalog.categories[0];
        if (cat.playlists.length > 0) {
            const pl = cat.playlists[0];
            if (pl.tracks.length > 0) {
                playTrackList(pl.tracks, 0, pl);
            }
        }
    }
}

function setIsPlaying(playing) {
    isPlaying = playing;
    
    // Sync Play button icons
    if (playIcon) {
        if (isPlaying) {
            playIcon.innerHTML = `<path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>`; // Pause symbol
        } else {
            playIcon.innerHTML = `<path d="M8 5v14l11-7z"/>`; // Play symbol
        }
    }
    
    // Spin/unspin player artwork
    const art = document.getElementById("player-artwork-img");
    if (art) {
        art.classList.toggle("spinning", isPlaying);
    }
}

// Update playback progress bars
function updateProgressUI() {
    if (!audioEl || !audioEl.duration) return;
    
    const pct = (audioEl.currentTime / audioEl.duration) * 100;
    if (timelineFill) timelineFill.style.width = `${pct}%`;
    if (timelineThumb) timelineThumb.style.left = `${pct}%`;
    if (timeCurrent) timeCurrent.textContent = formatDuration(audioEl.currentTime);
}

// Update volume bars
function updateVolumeSliderUI() {
    if (!volumeFill || !volumeThumb) return;
    
    const targetPct = isMuted ? 0 : activeVolume * 100;
    volumeFill.style.width = `${targetPct}%`;
    volumeThumb.style.left = `${targetPct}%`;
    
    const icon = document.getElementById("volume-icon");
    if (icon) {
        if (isMuted || activeVolume === 0) {
            icon.innerHTML = `<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/>`; // Mute icon
        } else if (activeVolume < 0.4) {
            icon.innerHTML = `<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>`; // Medium/Low volume
        } else {
            icon.innerHTML = `<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/>`; // High volume
        }
    }
}

// Sync playlist detail drawer and queue list highlight states
function updateActiveRowsUI() {
    document.querySelectorAll(".track-row").forEach(row => {
        row.classList.remove("active");
    });
    
    if (currentTrack) {
        // Highlight active tracks in DOM matching currentTrack id
        const activeRows = document.querySelectorAll(`.track-row`);
        activeRows.forEach(row => {
            const titleEl = row.querySelector(".track-row-title");
            if (titleEl && titleEl.textContent === currentTrack.title) {
                row.classList.add("active");
            }
        });
    }
}

// Update Meta display on bottom bar
function updatePlayerMetaUI() {
    if (!currentTrack) return;
    
    document.getElementById("player-track-title").textContent = currentTrack.title;
    document.getElementById("player-track-artist").textContent = currentTrack.artist || "LoFiStudio";
    
    // Set artwork
    const artImg = document.getElementById("player-artwork-img");
    if (artImg) {
        // Resolve artwork
        const artworkName = currentTrack.artworkName || (currentPlaylist ? currentPlaylist.artworkName : null);
        artImg.src = getArtworkUrl(artworkName);
    }
    
    // Sync Heart/Fav icon
    const favBtn = document.getElementById("player-fav-toggle");
    if (favBtn) {
        favBtn.style.display = "block";
        const isFav = favorites.includes(currentTrack.id);
        favBtn.classList.toggle("favorited", isFav);
        
        const path = favBtn.querySelector("svg");
        path.setAttribute("fill", isFav ? "currentColor" : "none");
    }
}

// 5. EVENT HANDLERS & ACTIONS

function setupEventHandlers() {
    // View switching binds
    document.getElementById("logo-btn").onclick = () => switchView("discover");
    document.getElementById("nav-discover").onclick = () => switchView("discover");
    document.getElementById("nav-categories").onclick = () => switchView("categories");
    document.getElementById("nav-favorites").onclick = () => switchView("favorites");
    
    document.getElementById("mob-nav-discover").onclick = () => switchView("discover");
    document.getElementById("mob-nav-categories").onclick = () => switchView("categories");
    document.getElementById("mob-nav-favorites").onclick = () => switchView("favorites");
    
    // Drawer close binds
    document.getElementById("playlist-modal-close").onclick = closePlaylistModal;
    document.getElementById("modal-overlay-el").onclick = closePlaylistModal;
    
    // Media Player control binds
    playBtn.onclick = togglePlay;
    document.getElementById("player-btn-prev").onclick = playPrevTrack;
    document.getElementById("player-btn-next").onclick = playNextTrack;
    
    const shuffleBtn = document.getElementById("player-btn-shuffle");
    shuffleBtn.onclick = () => {
        isShuffle = !isShuffle;
        shuffleBtn.classList.toggle("active", isShuffle);
        localStorage.setItem("lofistudio_shuffle", isShuffle);
        showNotification(isShuffle ? getTranslation("notif_shuffle_on") : getTranslation("notif_shuffle_off"), "info");
    };
    
    const repeatBtn = document.getElementById("player-btn-repeat");
    repeatBtn.onclick = () => {
        isRepeat = !isRepeat;
        repeatBtn.classList.toggle("active", isRepeat);
        localStorage.setItem("lofistudio_repeat", isRepeat);
        showNotification(isRepeat ? getTranslation("notif_repeat_on") : getTranslation("notif_repeat_off"), "info");
    };
    
    // Mute bind
    document.getElementById("player-volume-mute").onclick = () => {
        isMuted = !isMuted;
        audioEl.volume = isMuted ? 0 : activeVolume;
        localStorage.setItem("lofistudio_mute", isMuted);
        updateVolumeSliderUI();
    };

    // Favorite toggle on player bar
    const favToggle = document.getElementById("player-fav-toggle");
    favToggle.onclick = () => {
        if (currentTrack) {
            toggleFavorite(currentTrack.id);
            updatePlayerMetaUI();
            updateActiveRowsUI();
            if (activeView === "favorites") renderFavoritesPanel();
        }
    };
    
    // Seek timeline click bindings
    timelineSlider.onclick = (e) => {
        if (!audioEl || !audioEl.duration) return;
        const rect = timelineSlider.getBoundingClientRect();
        const pct = (e.clientX - rect.left) / rect.width;
        audioEl.currentTime = pct * audioEl.duration;
        updateProgressUI();
    };
    
    // Volume slider click bindings
    volumeSlider.onclick = (e) => {
        const rect = volumeSlider.getBoundingClientRect();
        let pct = (e.clientX - rect.left) / rect.width;
        pct = Math.max(0, Math.min(1, pct)); // clamp 0-1
        
        activeVolume = pct;
        isMuted = false;
        audioEl.volume = activeVolume;
        localStorage.setItem("lofistudio_volume", activeVolume);
        localStorage.setItem("lofistudio_mute", "false");
        
        updateVolumeSliderUI();
    };
    
    // Dynamic search filter bindings
    const searchInput = document.getElementById("search-input");
    searchInput.oninput = (e) => {
        const q = e.target.value.toLowerCase().trim();
        handleSearch(q);
    };
    
    // Mobile player overlay trigger toggle
    const playerBar = document.getElementById("player-bar-el");
    const mobileTrigger = document.getElementById("player-trigger-mobile");
    
    mobileTrigger.onclick = (e) => {
        // Only trigger fullscreen if on mobile screen size
        if (window.innerWidth <= 768) {
            playerBar.classList.toggle("fullscreen");
        }
    };
    
    // Language selector change binding
    const langSelect = document.getElementById("lang-select");
    if (langSelect) {
        langSelect.onchange = (e) => {
            setLanguage(e.target.value);
        };
    }
}

// Handle search query
function handleSearch(query) {
    if (!query) {
        // Restore active view elements
        renderApp();
        return;
    }
    
    // Force switch to discover view as a search dashboard
    switchView("discover");
    
    // Hide Featured Carousel during search
    document.getElementById("featured-section").style.display = "none";
    
    // Filter Categories
    const catGrid = document.getElementById("discover-categories-grid");
    catGrid.innerHTML = "";
    const filteredCats = catalog.categories.filter(cat => 
        cat.title.toLowerCase().includes(query) || 
        cat.mood.toLowerCase().includes(query)
    );
    filteredCats.forEach(c => catGrid.appendChild(createCategoryCard(c)));
    
    // Filter Playlists
    const playlistsGrid = document.getElementById("today-playlists-grid");
    playlistsGrid.innerHTML = "";
    
    const matchedPlaylists = [];
    catalog.categories.forEach(cat => {
        cat.playlists.forEach(pl => {
            const inTitle = pl.title.toLowerCase().includes(query);
            const inSub = pl.subtitle.toLowerCase().includes(query);
            const inTracks = pl.tracks.some(t => t.title.toLowerCase().includes(query) || t.artist?.toLowerCase().includes(query));
            
            if (inTitle || inSub || inTracks) {
                matchedPlaylists.push({ playlist: pl, category: cat });
            }
        });
    });
    
    matchedPlaylists.forEach(item => {
        playlistsGrid.appendChild(createPlaylistCard(item.playlist, item.category));
    });
    
    const titleEl = document.querySelector("#today-shelf .section-title");
    if (titleEl) {
        const headerText = getTranslation("search_results_header");
        const detailsText = getTranslation("search_results_details", { query: query, count: matchedPlaylists.length });
        titleEl.innerHTML = `${headerText} <span>${detailsText}</span>`;
    }
}

// Toggle Favorite state
function toggleFavorite(trackId) {
    const idx = favorites.indexOf(trackId);
    if (idx === -1) {
        favorites.push(trackId);
        showNotification(getTranslation("notif_added_favorites"), "success");
    } else {
        favorites.splice(idx, 1);
        showNotification(getTranslation("notif_removed_favorites"), "info");
    }
    localStorage.setItem("lofistudio_favorites", JSON.stringify(favorites));
}

// Restore previous session played track (if any)
function restoreLastSession() {
    if (!lastPlayedTrackId) return;
    
    // Scan catalog to find track
    let foundTrack = null;
    let foundPlaylist = null;
    
    for (const cat of catalog.categories) {
        for (const p of cat.playlists) {
            const t = p.tracks.find(track => track.id === lastPlayedTrackId);
            if (t) {
                foundTrack = t;
                foundPlaylist = p;
                break;
            }
        }
        if (foundTrack) break;
    }
    
    if (foundTrack) {
        currentTrack = foundTrack;
        currentPlaylist = foundPlaylist;
        
        // Build playing queue from this playlist
        playQueue = [...foundPlaylist.tracks];
        queueIndex = playQueue.findIndex(t => t.id === foundTrack.id);
        
        updatePlayerMetaUI();
        updateActiveRowsUI();
    }
}

// UI notification helper
function showNotification(msg, type = "info") {
    // Create element
    const notif = document.createElement("div");
    notif.style.position = "fixed";
    notif.style.bottom = "100px";
    notif.style.left = "50%";
    notif.style.transform = "translateX(-50%) translateY(20px)";
    notif.style.padding = "0.75rem 1.5rem";
    notif.style.borderRadius = "50px";
    notif.style.fontSize = "0.85rem";
    notif.style.fontWeight = "600";
    notif.style.zIndex = "100";
    notif.style.opacity = "0";
    notif.style.transition = "all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275)";
    notif.style.backdropFilter = "blur(12px)";
    notif.style.border = "1px solid rgba(255,255,255,0.1)";
    notif.style.boxShadow = "0 10px 25px rgba(0,0,0,0.5)";
    
    if (type === "success") {
        notif.style.backgroundColor = "rgba(91, 174, 107, 0.9)";
        notif.style.color = "#fff";
    } else if (type === "error") {
        notif.style.backgroundColor = "rgba(255, 107, 139, 0.9)";
        notif.style.color = "#fff";
    } else if (type === "warning") {
        notif.style.backgroundColor = "rgba(255, 221, 0, 0.9)";
        notif.style.color = "#000";
    } else {
        notif.style.backgroundColor = "rgba(157, 78, 221, 0.9)";
        notif.style.color = "#fff";
    }
    
    notif.textContent = msg;
    document.body.appendChild(notif);
    
    // Animate in
    setTimeout(() => {
        notif.style.opacity = "1";
        notif.style.transform = "translateX(-50%) translateY(0)";
    }, 50);
    
    // Animate out
    setTimeout(() => {
        notif.style.opacity = "0";
        notif.style.transform = "translateX(-50%) translateY(-20px)";
        setTimeout(() => {
            document.body.removeChild(notif);
        }, 300);
    }, 3000);
}

// Duration formatting utility
function formatDuration(sec) {
    if (isNaN(sec)) return "0:00";
    const minutes = Math.floor(sec / 60);
    const seconds = Math.floor(sec % 60);
    return `${minutes}:${seconds < 10 ? "0" : ""}${seconds}`;
}
