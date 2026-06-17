import './style.css';
import L from 'leaflet';

// Fix Leaflet's default icon paths in module bundlers
import iconRetinaUrl from 'leaflet/dist/images/marker-icon-2x.png';
import iconUrl from 'leaflet/dist/images/marker-icon.png';
import shadowUrl from 'leaflet/dist/images/marker-shadow.png';

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl,
  iconUrl,
  shadowUrl,
});

// Initializing the Leaflet Map
// Set default view to a generic global perspective (e.g., center of maps)
const map = L.map('map', {
  zoomControl: false // We will move it to a better position
}).setView([20, 0], 3);

// Add light map tiles
L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
  subdomains: 'abcd',
  maxZoom: 20
}).addTo(map);

// Move zoom control to bottom right so it doesn't overlap dashboard
L.control.zoom({
  position: 'bottomright'
}).addTo(map);

let currentMarker = null;

// DOM Elements
const searchBtn = document.getElementById('search-btn');
const searchInput = document.getElementById('location-search');
const loadingState = document.getElementById('loading-state');
const resultsPanel = document.getElementById('results-panel');
const resultLocationName = document.getElementById('result-location-name');
const resultDate = document.getElementById('result-date');
const scoreCircle = document.getElementById('score-circle');
const scoreText = document.getElementById('score-text');
const riskLabel = document.getElementById('risk-label');
const riskDesc = document.getElementById('risk-desc');
const realtimeStats = document.getElementById('realtime-stats');
const currentRainEl = document.getElementById('current-rain');
const forecastRainEl = document.getElementById('forecast-rain');
const forecastSection = document.getElementById('forecast-section');
const forecastList = document.getElementById('forecast-list');

// Format today's date
const today = new window.Intl.DateTimeFormat('en-US', {
  weekday: 'short',
  year: 'numeric',
  month: 'short',
  day: 'numeric'
}).format(new Date());

resultDate.textContent = today;

// --- App Logic ---

async function handleSearch() {
  const query = searchInput.value.trim();
  if (!query) return;

  // Show loading
  resultsPanel.classList.add('hidden');
  loadingState.classList.remove('hidden');
  
  try {
    // 1. Geocode the location using Nominatim API
    const geoRes = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}`);
    const geoData = await geoRes.json();
    
    if (geoData && geoData.length > 0) {
      const bestMatch = geoData[0];
      const lat = parseFloat(bestMatch.lat);
      const lon = parseFloat(bestMatch.lon);
      
      // Update UI Location Name
      const locationNameParts = bestMatch.display_name.split(',');
      resultLocationName.textContent = `${locationNameParts[0]}${locationNameParts.length > 1 ? ',' + locationNameParts[1] : ''}`;
      
      // Fly to location
      map.flyTo([lat, lon], 12, { duration: 1.5 });
      
      // Add/Update Marker
      if (currentMarker) {
        map.removeLayer(currentMarker);
      }
      currentMarker = L.marker([lat, lon]).addTo(map)
        .bindPopup(`<b>${resultLocationName.textContent}</b><br>Flood Risk Analysis Area`)
        .openPopup();

      // 2. Fetch Real-time Weather Data from Open-Meteo
      // This sends coordinates to the free Open-Meteo API to fetch current and 3-day forecasted precipitation.
      
      const weatherRes = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=precipitation&daily=precipitation_sum,precipitation_probability_max&timezone=auto`);
      const weatherData = await weatherRes.json();
      
      const currentRain = weatherData.current.precipitation || 0; // current rain in mm
      
      // Calculate total forecasted rain for the next 3 days
      let forecastRainSum = 0;
      if (weatherData.daily && weatherData.daily.precipitation_sum) {
          for(let i = 1; i <= 3; i++) {
              forecastRainSum += weatherData.daily.precipitation_sum[i] || 0;
          }
      }

      // 3. Real-Time Confidence Scoring (0-100)
      setTimeout(() => {
        const analysisDetails = calculateRealTimeScore(currentRain, forecastRainSum);
        updateDashboard(analysisDetails.score, analysisDetails.desc, currentRain, forecastRainSum, weatherData.daily);
        
        // Hide loading, show results
        loadingState.classList.add('hidden');
        resultsPanel.classList.remove('hidden');
      }, 800); // Simulate processing latency for UI effect

    } else {
      throw new Error("Location not found");
    }
  } catch (err) {
    console.error(err);
    alert("Could not find this location or process its data. Please try another query.");
    loadingState.classList.add('hidden');
  }
}

// Calculate Risk Score based on real-time and forecasted rain
function calculateRealTimeScore(currentRain, forecastRainSum) {
  let score = 100;
  let desc = "";

  // Deduct based on current rain (Heavy rain = fast deduction)
  if (currentRain > 0) {
    score -= Math.min(30, currentRain * 2); 
  }

  // Deduct based on forecasted rain (3 days total. > 50mm is bad)
  if (forecastRainSum > 0) {
    score -= Math.min(60, (forecastRainSum / 50) * 50); 
  }

  score = Math.max(5, Math.min(100, Math.round(score))); // Clamp between 5 and 100

  // Generate dynamic description
  if (score >= 75) {
      desc = `Safe. Current conditions and forecast indicate minimal rainfall (${forecastRainSum.toFixed(1)}mm expected sequentially).`;
  } else if (score >= 40) {
      if (currentRain > 2) {
          desc = `Caution. Currently experiencing rainfall (${currentRain}mm/hr). Keep an eye on local real-time alerts.`;
      } else {
          desc = `Moderate Risk. Forecast predicts significant rainfall (${forecastRainSum.toFixed(1)}mm expected). Monitor conditions.`;
      }
  } else {
      desc = `High Danger. Heavy rainfall detected or forecasted (${forecastRainSum.toFixed(1)}mm expected). Travel is not recommended due to high flood probability.`;
  }

  return { score, desc };
}

// Update the UI Dashboard with the calculated score
function updateDashboard(score, description, currentRainAmount, forecastRainAmount, dailyForecasts) {
  // Reset theme classes
  scoreCircle.classList.remove('theme-safe', 'theme-warn', 'theme-danger');
  riskLabel.classList.remove('theme-safe', 'theme-warn', 'theme-danger');
  
  // Animate text
  let currentVal = 0;
  const duration = 1000;
  const fps = 60;
  const frames = duration / (1000 / fps);
  const increment = score / frames;
  
  const timer = setInterval(() => {
    currentVal += increment;
    if (currentVal >= score) {
      currentVal = score;
      clearInterval(timer);
    }
    scoreText.textContent = `${Math.round(currentVal)}%`;
  }, 1000 / fps);

  // Update circle length
  scoreCircle.style.strokeDasharray = `${score}, 100`;
  
  // Set text and colors based on Risk Level
  let themeClass = '';
  if (score >= 75) {
    themeClass = 'theme-safe';
    riskLabel.textContent = 'Safe to Travel';
  } else if (score >= 40) {
    themeClass = 'theme-warn';
    riskLabel.textContent = 'Moderate Risk';
  } else {
    themeClass = 'theme-danger';
    riskLabel.textContent = 'High Flood Danger';
  }
  
  riskDesc.textContent = description;
  
  scoreCircle.classList.add(themeClass);
  riskLabel.classList.add(themeClass);
  
  // Show realtime stats
  currentRainEl.textContent = `${currentRainAmount} mm`;
  forecastRainEl.textContent = `${forecastRainAmount.toFixed(1)} mm`;
  realtimeStats.classList.remove('hidden');

  // Render future forecast
  renderForecast(dailyForecasts);
}

// Render the 7-day forecast
function renderForecast(daily) {
  if (!daily || !daily.time) return;
  
  forecastList.innerHTML = ''; // Clear previous
  forecastSection.classList.remove('hidden');
  
  // Start from tomorrow (index 1) to the end of the available forecast
  for (let i = 1; i < daily.time.length; i++) {
    const dateStr = daily.time[i];
    const rain = daily.precipitation_sum[i] || 0;
    
    // Formatting date
    const dateObj = new Date(dateStr);
    const dateFormatted = new window.Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).format(dateObj);
    
    // Determine risk badge for this individual day
    let badgeClass = 'badge-safe';
    let badgeText = 'Safe';
    if (rain > 20) {
      badgeClass = 'badge-danger';
      badgeText = 'Danger';
    } else if (rain > 5) {
      badgeClass = 'badge-warn';
      badgeText = 'Risk';
    }
    
    const item = document.createElement('div');
    item.className = 'forecast-item';
    item.innerHTML = `
      <span class="forecast-date">${dateFormatted}</span>
      <div class="forecast-details">
        <span class="forecast-rain">${rain.toFixed(1)} mm</span>
        <span class="forecast-badge ${badgeClass}">${badgeText}</span>
      </div>
    `;
    forecastList.appendChild(item);
  }
}

// Event Listeners
searchBtn.addEventListener('click', handleSearch);
searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    handleSearch();
  }
});

// Setup map interaction to close the panel if on mobile and clicked outside
map.on('click', () => {
  searchInput.blur();
});
