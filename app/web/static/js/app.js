// State management
let isRunning = false;
let loggedMessagesCount = 0;
let pollingInterval = null;

// DOM Elements
const scrapeForm = document.getElementById('scrape-form');
const queryInput = document.getElementById('search-query');
const formatSelect = document.getElementById('output-format');
const headlessCheckbox = document.getElementById('headless-mode');
const startBtn = document.getElementById('start-btn');
const stopBtn = document.getElementById('stop-btn');
const statusBadge = document.getElementById('status-badge');
const statusLabel = statusBadge.querySelector('.status-label');
const metricCount = document.getElementById('metric-count');
const metricQuery = document.getElementById('metric-query');
const consoleOutput = document.getElementById('console-output');
const clearConsoleBtn = document.getElementById('clear-console-btn');
const autoscrollToggle = document.getElementById('autoscroll-toggle');
const noFilesMessage = document.getElementById('no-files-message');
const filesList = document.getElementById('files-list');
const refreshFilesBtn = document.getElementById('refresh-files-btn');

// Start polling status
function startPolling() {
    if (pollingInterval) clearInterval(pollingInterval);
    pollingInterval = setInterval(fetchStatus, 1000);
}

// Stop polling status
function stopPolling() {
    if (pollingInterval) {
        clearInterval(pollingInterval);
        pollingInterval = null;
    }
}

// Format file size
function formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Format relative/friendly timestamp
function formatTime(timestamp) {
    const date = new Date(timestamp * 1000);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

// Determine console line class
function getLogClass(message) {
    const lower = message.toLowerCase();
    if (lower.includes('error') || lower.includes('exception') || lower.includes('failed')) {
        return 'error';
    }
    if (lower.includes('hurrah') || lower.includes('successfully') || lower.includes('saved')) {
        return 'success';
    }
    if (lower.includes('start') || lower.includes('working') || lower.includes('opening') || lower.includes('scrolling')) {
        return 'info';
    }
    return 'system';
}

// Translate obscure technical exceptions, errors and timeouts to plain language
function translateToPlainLanguage(message) {
    if (!message) return "";
    
    const lower = message.toLowerCase();
    
    // 1. undetected-chromedriver and chromedriver launch crashed (exited unexpectedly, status code -11, etc.)
    if (lower.includes('unexpectedly exited') || (lower.includes('chromedriver') && (lower.includes('status code') || lower.includes('exit')))) {
        return "The scraper's browser helper shut down unexpectedly. This is usually due to security permissions (macOS) or an incompatible Google Chrome version. Please run the setup script again, or try switching 'Headless Mode' in Configuration.";
    }
    
    // 2. Navigation timeout
    if (lower.includes('timeout') && (lower.includes('navigation') || lower.includes('loader') || lower.includes('aborted') || lower.includes('resolving nodes'))) {
        return "The webpage took too long to load or was interrupted. We are attempting to recover and continue automatically.";
    }
    
    // 3. Browser window closed or unreachable
    if (lower.includes('no such window') || lower.includes('chrome not reachable') || lower.includes('window was already closed') || lower.includes('target window already closed')) {
        return "The browser window was closed or became unresponsive. Scraping has been stopped.";
    }
    
    // 4. Connection / Network socket issues
    if (lower.includes('maxretryerror') || lower.includes('connectionerror') || lower.includes('newconnectionerror') || lower.includes('dns') || lower.includes('failed to establish') || lower.includes('connection aborted')) {
        return "Network Connection Issue: Google Maps or your internet is unreachable. Please check your connection and try again.";
    }
    
    // 5. File read/write permission errors (e.g. file is open in Excel)
    if (lower.includes('permissionerror') || lower.includes('permission denied') || lower.includes('file is in use') || lower.includes('locked')) {
        return "File Access Error: We cannot save the scraping results. Please make sure the output spreadsheet is closed and that the application has folder write permissions.";
    }
    
    // 6. No records found warning
    if (lower.includes('could not scrape') && lower.includes('did not scrape any record')) {
        return "No records were found for this query. Try a different search query or location.";
    }
    
    // 7. General Selenium NoSuchElement or StaleElement elements
    if (lower.includes('no such element') || lower.includes('stale element') || lower.includes('unable to locate')) {
        return "The page elements loaded slowly or changed. The scraper is automatically refreshing context and retrying...";
    }
    
    // 8. General exception cleanup (hide stack traces, format nicely)
    if (message.startsWith("WebBridge Exception: ") || message.startsWith("Error: ")) {
        const cleanMsg = message.replace(/^(WebBridge Exception:\s*|Error:\s*)/i, '').trim();
        if (cleanMsg.includes('\n') || cleanMsg.includes('Traceback') || cleanMsg.includes('Stacktrace')) {
            return "An unexpected browser helper issue occurred. We are attempting to recover and resume parsing.";
        }
        return `Task issue encountered: ${cleanMsg}`;
    }
    
    return message;
}

// Append log to terminal console
function appendLogLine(message) {
    const line = document.createElement('div');
    line.className = `console-line ${getLogClass(message)}`;
    line.textContent = translateToPlainLanguage(message);
    consoleOutput.appendChild(line);
    
    if (autoscrollToggle.checked) {
        consoleOutput.scrollTop = consoleOutput.scrollHeight;
    }
}

// Fetch scraper status
async function fetchStatus() {
    try {
        const response = await fetch('/api/status');
        const data = await response.json();
        
        // Update Running state
        if (data.is_running !== isRunning) {
            isRunning = data.is_running;
            updateUIState();
            
            // If it just stopped, refresh the files list
            if (!isRunning) {
                stopPolling();
                fetchFiles();
            }
        }
        
        // Update metrics
        metricCount.textContent = data.scraped_count || 0;
        metricQuery.textContent = data.query || '-';
        
        // Append new messages
        if (data.messages && data.messages.length > loggedMessagesCount) {
            for (let i = loggedMessagesCount; i < data.messages.length; i++) {
                appendLogLine(data.messages[i]);
            }
            loggedMessagesCount = data.messages.length;
        }
    } catch (error) {
        console.error('Error fetching status:', error);
    }
}

// Update UI Buttons and Badges based on active state
function updateUIState() {
    if (isRunning) {
        // Status Badge
        statusBadge.className = 'badge running';
        statusLabel.textContent = 'Running';
        
        // Buttons
        startBtn.disabled = true;
        stopBtn.disabled = false;
        
        // Inputs
        queryInput.disabled = true;
        formatSelect.disabled = true;
        headlessCheckbox.disabled = true;
    } else {
        // Status Badge
        statusBadge.className = 'badge idle';
        statusLabel.textContent = 'Idle';
        
        // Buttons
        startBtn.disabled = false;
        stopBtn.disabled = true;
        
        // Inputs
        queryInput.disabled = false;
        formatSelect.disabled = false;
        headlessCheckbox.disabled = false;
    }
}

// Submit search query to start scraper
scrapeForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const query = queryInput.value.trim();
    const format = formatSelect.value;
    const headless = headlessCheckbox.checked;
    
    if (!query) return;
    
    // Reset local log count
    consoleOutput.innerHTML = '';
    loggedMessagesCount = 0;
    
    appendLogLine(`Starting scraping task for: "${query}"...`);
    
    try {
        const response = await fetch('/api/scrape', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query, format, headless })
        });
        const data = await response.json();
        
        if (data.success) {
            isRunning = true;
            updateUIState();
            startPolling();
        } else {
            appendLogLine(`[Error] Failed to start: ${data.message}`);
        }
    } catch (error) {
        appendLogLine(`[Error] Connection failed: ${error.message}`);
    }
});

// Send stop signal
stopBtn.addEventListener('click', async () => {
    try {
        stopBtn.disabled = true;
        const response = await fetch('/api/stop', { method: 'POST' });
        const data = await response.json();
        if (data.success) {
            appendLogLine("Stop command issued. Waiting for browser to clean up...");
        } else {
            appendLogLine(`[Error] Stop command failed: ${data.message}`);
            stopBtn.disabled = false;
        }
    } catch (error) {
        appendLogLine(`[Error] Stop command failed: ${error.message}`);
        stopBtn.disabled = false;
    }
});

// Fetch downloadable output files
async function fetchFiles() {
    try {
        const response = await fetch('/api/files');
        const files = await response.json();
        
        if (files.length === 0) {
            noFilesMessage.style.display = 'flex';
            filesList.style.display = 'none';
            return;
        }
        
        noFilesMessage.style.display = 'none';
        filesList.style.display = 'flex';
        filesList.innerHTML = '';
        
        files.forEach(file => {
            const item = document.createElement('div');
            item.className = 'file-item';
            
            // Icon based on type
            let iconType = 'file-spreadsheet';
            let iconClass = 'excel';
            if (file.name.endsWith('.json')) {
                iconType = 'file-json';
                iconClass = 'json';
            } else if (file.name.endsWith('.csv')) {
                iconType = 'file-text';
                iconClass = 'csv';
            }
            
            item.innerHTML = `
                <div class="file-details">
                    <div class="file-icon ${iconClass}">
                        <i data-lucide="${iconType}"></i>
                    </div>
                    <div class="file-meta">
                        <span class="file-name" title="${file.name}">${file.name}</span>
                        <span class="file-size-time">${formatBytes(file.size)} &bull; ${formatTime(file.modified)}</span>
                    </div>
                </div>
                <a href="/api/download/${encodeURIComponent(file.name)}" download="${file.name}" class="btn-download" title="Download">
                    <i data-lucide="download"></i>
                </a>
            `;
            filesList.appendChild(item);
        });
        
        // Re-run Lucide icons for injected elements
        lucide.createIcons();
    } catch (error) {
        console.error('Error fetching files:', error);
    }
}

// Clear logs UI action
clearConsoleBtn.addEventListener('click', () => {
    consoleOutput.innerHTML = '<div class="console-line system">Console cleared.</div>';
});

// Refresh button trigger
refreshFilesBtn.addEventListener('click', fetchFiles);

// Initialize Light/Dark Theme Preference
function initTheme() {
    const themeToggle = document.getElementById('theme-toggle');
    if (!themeToggle) return;
    
    // Check saved choice or system preferences
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'light') {
        document.body.classList.add('light-mode');
    } else if (savedTheme === 'dark') {
        document.body.classList.remove('light-mode');
    } else {
        // System media preference
        if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) {
            document.body.classList.add('light-mode');
        }
    }
    
    themeToggle.addEventListener('click', () => {
        const isLight = document.body.classList.toggle('light-mode');
        localStorage.setItem('theme', isLight ? 'light' : 'dark');
    });
}

// On Page Load Initialization
window.addEventListener('DOMContentLoaded', () => {
    initTheme();
    fetchStatus();
    fetchFiles();
    
    // Check if the scraper is running from a previous page session
    setTimeout(() => {
        if (isRunning) {
            startPolling();
        }
    }, 500);
});
