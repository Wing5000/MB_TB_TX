const DATA_VERSION = 1;

// Configuration
const CONTRACT_ADDRESS = "0x86c66061a0e55d91c8bfa464fe84dc58f8733253";
const DEPLOY_BLOCK = 11354233;
const RPC_ENDPOINTS = getRpcEndpointsFromConfigOrUI();
const MOONSCAN_API_KEY = getMoonscanKeyFromUIOrEnv();
const MOONSCAN_BASE_URL = "https://moonbeam.unitedbloc.com:2000/api";

function getRpcEndpointsFromConfigOrUI() {
    // The first endpoint should be the canonical provider; additional endpoints
    // may be supplied by the user interface or configuration.
    const defaults = ["https://rpc.api.moonbeam.network"];
    if (typeof window !== 'undefined' && window.rpcEndpointsConfig) {
        return [defaults[0], ...window.rpcEndpointsConfig];
    }
    return defaults;
}

function getMoonscanKeyFromUIOrEnv() {
    if (typeof localStorage !== 'undefined') {
        const key = localStorage.getItem('moonscanApiKey');
        if (key) return key;
    }
    if (typeof process !== 'undefined' && process.env.MOONSCAN_API_KEY) {
        return process.env.MOONSCAN_API_KEY;
    }
    return '';
}

class MoonbeamContractMonitor {
    constructor() {
        this.contractAddress = CONTRACT_ADDRESS;
        this.rpcEndpoints = RPC_ENDPOINTS;
        this.wssEndpoint = undefined; // not used in this monitor
        this.currentRpcIndex = 0;

        // Moonscan API configuration
        this.moonscanApiKey = MOONSCAN_API_KEY;
        this.moonscanLastRequest = 0;

        this.transactionData = new Map();
        this.displayData = [];
        this.currentPage = 1;
        this.itemsPerPage = 25;
        this.sortColumn = 'txCount';
        this.sortDirection = 'desc';
        this.autoRefreshEnabled = true;
        this.refreshInterval = null;
        this.isLoading = false;
        this.refreshCount = 0;
        this.searchQuery = '';
        this.searchTimeout = null;
        this.lastFetchedBlock = 0;

        this.loadState();

        this.initializeElements();
        this.setupEventListeners();
        this.prepareDisplayData();
        this.displayTable();
        this.updateMetrics();
        this.startInitialLoad();
    }

    initializeElements() {
        this.elements = {
            autoRefreshToggle: document.getElementById('autoRefreshToggle'),
            statusText: document.getElementById('statusText'),
            loadingSpinner: document.getElementById('loadingSpinner'),
            uniqueAddresses: document.getElementById('uniqueAddresses'),
            totalTransactions: document.getElementById('totalTransactions'),
            lastUpdate: document.getElementById('lastUpdate'),
            errorContainer: document.getElementById('errorContainer'),
            prevPage: document.getElementById('prevPage'),
            nextPage: document.getElementById('nextPage'),
            pageInfo: document.getElementById('pageInfo'),
            tableBody: document.getElementById('transactionTableBody'),
            rankHeader: document.getElementById('rankHeader'),
            addressHeader: document.getElementById('addressHeader'),
            txCountHeader: document.getElementById('txCountHeader'),
            addressSearch: document.getElementById('addressSearch'),
            resetButton: document.getElementById('resetData')
        };
    }

    setupEventListeners() {
        this.elements.autoRefreshToggle.addEventListener('click', () => {
            this.toggleAutoRefresh();
        });

        this.elements.prevPage.addEventListener('click', () => {
            if (this.currentPage > 1) {
                this.currentPage--;
                this.displayTable();
            }
        });

        this.elements.nextPage.addEventListener('click', () => {
            const maxPages = Math.ceil(this.displayData.length / this.itemsPerPage);
            if (this.currentPage < maxPages) {
                this.currentPage++;
                this.displayTable();
            }
        });

        this.elements.resetButton.addEventListener('click', () => {
            this.transactionData.clear();
            this.lastFetchedBlock = 0;
            this.saveState();
            this.prepareDisplayData();
            this.displayTable();
            this.updateMetrics();
            this.loadTransactionData();
        });

        // Sortowanie kolumn
        this.elements.rankHeader.addEventListener('click', () => this.sortBy('rank'));
        this.elements.addressHeader.addEventListener('click', () => this.sortBy('address'));
        this.elements.txCountHeader.addEventListener('click', () => this.sortBy('txCount'));

        this.elements.addressSearch.addEventListener('input', (e) => {
            clearTimeout(this.searchTimeout);
            const value = e.target.value.trim().toLowerCase();
            this.searchTimeout = setTimeout(() => {
                this.searchQuery = value;
                this.currentPage = 1;
                this.prepareDisplayData();
                this.displayTable();
            }, 300);
        });
    }

    toggleAutoRefresh() {
        this.autoRefreshEnabled = !this.autoRefreshEnabled;
        this.elements.autoRefreshToggle.classList.toggle('active', this.autoRefreshEnabled);
        
        if (this.autoRefreshEnabled) {
            this.startAutoRefresh();
        } else {
            this.stopAutoRefresh();
        }
    }

    startAutoRefresh() {
        this.stopAutoRefresh();
        this.refreshInterval = setInterval(() => {
            if (!this.isLoading) {
                this.refreshCount++;
                console.log(`Auto-refresh #${this.refreshCount}`);
                this.loadTransactionData();
            }
        }, 60000);
    }

    stopAutoRefresh() {
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
            this.refreshInterval = null;
        }
    }

    loadState() {
        try {
            const storedVersion = parseInt(localStorage.getItem('dataVersion') || '0', 10);
            if (!storedVersion || storedVersion < DATA_VERSION) {
                this.transactionData = new Map();
                this.lastFetchedBlock = 0;
                this.saveState();
                return;
            }

            const savedData = localStorage.getItem('transactionData');
            if (savedData) {
                const parsed = JSON.parse(savedData);
                this.transactionData = new Map(Object.entries(parsed));
            }

            const savedBlock = localStorage.getItem('lastFetchedBlock');
            if (savedBlock) {
                const block = parseInt(savedBlock, 10);
                if (!isNaN(block)) {
                    this.lastFetchedBlock = block;
                }
            }
        } catch (error) {
            console.error('Error loading state from localStorage:', error);
        }
    }

    saveState() {
        try {
            const serialized = JSON.stringify(Object.fromEntries(this.transactionData));
            localStorage.setItem('transactionData', serialized);
            localStorage.setItem('lastFetchedBlock', this.lastFetchedBlock.toString());
            localStorage.setItem('dataVersion', DATA_VERSION.toString());
        } catch (error) {
            console.error('Error saving state to localStorage:', error);
        }
    }

    async startInitialLoad() {
        await this.loadTransactionData();
        if (this.autoRefreshEnabled) {
            this.startAutoRefresh();
        }
    }

    showError(friendlyMessage, technicalDetail) {
        this.elements.errorContainer.innerHTML = `
            <div class="error-message">
                <div><strong>Błąd:</strong> ${friendlyMessage}</div>
                <div class="technical-detail">${technicalDetail}</div>
                <button class="retry-button">Spróbuj ponownie</button>
            </div>
        `;

        const retry = this.elements.errorContainer.querySelector('.retry-button');
        if (retry) {
            retry.addEventListener('click', () => this.loadTransactionData());
        }
    }

    hideError() {
        this.elements.errorContainer.innerHTML = '';
    }

    setLoading(loading) {
        this.isLoading = loading;
        this.elements.loadingSpinner.style.display = loading ? 'block' : 'none';
        
        if (loading) {
            this.elements.statusText.textContent = 'Pobieranie danych...';
        } else {
            const count = this.transactionData.size;
            const total = Array.from(this.transactionData.values()).reduce((sum, count) => sum + count, 0);
            this.elements.statusText.textContent = `${count} adresów, ${total} transakcji`;
        }
    }

    async loadTransactionData() {
        this.setLoading(true);
        this.hideError();

        try {
            const allTransactions = await this.fetchAllTransactions();
            const newData = this.processTransactions(allTransactions);
            newData.forEach((count, address) => {
                const current = this.transactionData.get(address) || 0;
                this.transactionData.set(address, current + count);
            });
            this.prepareDisplayData();
            this.displayTable();
            this.updateMetrics();
            this.saveState();

            console.log(`Załadowano ${allTransactions.length} transakcji z ${this.transactionData.size} unikalnych adresów`);
        } catch (error) {
            console.error('Error loading transaction data:', error);

            let errorMessage = 'Nieznany błąd';
            if (error.message.includes('Failed to fetch')) {
                errorMessage = 'Problem z połączeniem internetowym. Sprawdź połączenie i spróbuj ponownie.';
            } else if (error.message.includes('Wszystkie RPC endpoints')) {
                errorMessage = 'Wszystkie RPC endpoints Moonbeam są niedostępne. Spróbuj ponownie za chwilę.';
            } else {
                errorMessage = error.message;
            }

            this.showError(errorMessage, error.message);
        } finally {
            this.setLoading(false);
        }
    }

    /**
     * Ogólny wrapper dla zapytań do Moonscan API z obsługą limitów i ponowień.
     */
    async makeMoonscanRequest(params) {
        const maxRetries = 5;
        let backoff = 400;

        for (let attempt = 0; attempt < maxRetries; attempt++) {
            const url = `${MOONSCAN_BASE_URL}?${params.toString()}`;
            try {
                const response = await fetch(url);
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}`);
                }
                const data = await response.json();
                console.log(`Moonscan status=${data.status} message=${data.message} result=${typeof data.result === 'string' ? data.result.slice(0, 80) : JSON.stringify(data.result).slice(0,80)}`);

                if (data.status === '1') {
                    return data.result;
                }

                const message = `${data.message || ''} ${data.result || ''}`.toLowerCase();
                if (message.includes('no transactions found')) {
                    return [];
                }
                if (message.includes('rate limit')) {
                    console.warn(`⚠️ Moonscan rate limit, retrying in ${backoff}ms`);
                    await new Promise(r => setTimeout(r, backoff));
                    backoff = Math.min(backoff * 2, 1600);
                    continue;
                }
                throw new Error(`${data.message}: ${data.result}`);
            } catch (error) {
                console.error('Moonscan API error:', error.message);
                if (attempt === maxRetries - 1) {
                    throw error;
                }
                await new Promise(r => setTimeout(r, backoff));
                backoff = Math.min(backoff * 2, 1600);
            }
        }
        return [];
    }

    /**
     * Ustala blok startowy na podstawie transakcji tworzącej kontrakt.
     */
    async getContractCreationBlock() {
        return DEPLOY_BLOCK;
    }

    /**
     * Pobiera pełną historię transakcji z Moonscanu używając stronicowania.
     */
    async fetchHistoricalTransactions() {
        let page = 1;
        const allTxs = [];
        const seen = new Set();

        while (true) {
            const params = new URLSearchParams({
                module: 'account',
                action: 'txlist',
                address: this.contractAddress,
                startblock: DEPLOY_BLOCK.toString(),
                endblock: '99999999',
                sort: 'asc',
                page: page.toString(),
                offset: '10000'
            });
            if (this.moonscanApiKey) params.append('apikey', this.moonscanApiKey);

            const result = await this.makeMoonscanRequest(params);
            if (!result || result.length === 0) break;

            result
                .filter(tx => tx.to && tx.to.toLowerCase() === this.contractAddress.toLowerCase() && tx.isError === '0' && (!tx.txreceipt_status || tx.txreceipt_status === '1'))
                .forEach(tx => {
                    if (!seen.has(tx.hash)) {
                        seen.add(tx.hash);
                        allTxs.push({
                            from: tx.from,
                            to: tx.to,
                            hash: tx.hash,
                            blockNumber: parseInt(tx.blockNumber)
                        });
                    }
                });

            page++;
            await new Promise(r => setTimeout(r, 300));
        }

        if (allTxs.length > 0) {
            this.lastFetchedBlock = Math.max(...allTxs.map(t => t.blockNumber));
        } else {
            this.lastFetchedBlock = DEPLOY_BLOCK;
        }
        return allTxs;
    }

    async fetchTransactionsWithRPC() {
        const transactions = [];
        let maxSpan = 1000;

        console.log('🔍 Pobieranie transakcji z Moonbeam RPC...');

        const latestBlockHex = await this.makeRpcCall('eth_blockNumber', []);
        const latestBlock = parseInt(latestBlockHex, 16);
        console.log(`📊 Najnowszy blok: ${latestBlock}`);

        let fromBlock = this.lastFetchedBlock + 1;
        if (fromBlock < DEPLOY_BLOCK) fromBlock = DEPLOY_BLOCK;
        if (fromBlock > latestBlock) {
            console.log('⏭️  Brak nowych bloków do pobrania');
            return transactions;
        }

        while (fromBlock <= latestBlock) {
            let toBlock = Math.min(fromBlock + maxSpan - 1, latestBlock);
            const provider = this.rpcEndpoints[this.currentRpcIndex];
            console.log(`RPC: ${provider} zakres ${fromBlock}-${toBlock} MAX_SPAN=${maxSpan}`);
            try {
                const logs = await this.makeRpcCall('eth_getLogs', [{
                    fromBlock: `0x${fromBlock.toString(16)}`,
                    toBlock: `0x${toBlock.toString(16)}`,
                    address: this.contractAddress
                }]);

                if (logs && logs.length > 0) {
                    const batchTxs = await this.getTransactionDetails(logs);
                    transactions.push(...batchTxs);
                    console.log(`✅ logów: ${logs.length}, transakcji: ${batchTxs.length}`);
                } else {
                    const fallbackTxs = await this.scanBlocksForTransactions(fromBlock, toBlock);
                    if (fallbackTxs.length > 0) {
                        console.log(`🔁 Fallback block scan found ${fallbackTxs.length} transactions`);
                        transactions.push(...fallbackTxs);
                    } else {
                        console.log(`⏭️  Brak transakcji w blokach ${fromBlock}-${toBlock}`);
                    }
                }

                fromBlock = toBlock + 1;
            } catch (error) {
                console.error(`❌ Błąd dla bloków ${fromBlock}-${toBlock}: ${error.message}`);
                if (/range is too wide|query returned more than/i.test(error.message) && maxSpan > 64) {
                    maxSpan = Math.max(64, Math.floor(maxSpan / 2));
                    console.warn(`📉 Zmniejszam MAX_SPAN do ${maxSpan}`);
                } else {
                    throw error;
                }
            }

            await new Promise(r => setTimeout(r, 120));
        }

        this.lastFetchedBlock = latestBlock;
        console.log(`🎉 Pobieranie zakończone: ${transactions.length} unikalnych transakcji`);
        return transactions;
    }

    async scanBlocksForTransactions(fromBlock, toBlock) {
        const txs = [];
        const concurrency = 3;
        const blocks = [];
        for (let b = fromBlock; b <= toBlock; b++) {
            blocks.push(b);
        }
        const limit = (fn) => {
            const queue = [];
            let active = 0;
            const next = () => {
                active--;
                if (queue.length) queue.shift()();
            };
            return (...args) => new Promise((resolve, reject) => {
                const run = () => {
                    active++;
                    Promise.resolve(fn(...args)).then(resolve).catch(reject).finally(next);
                };
                if (active < concurrency) run(); else queue.push(run);
            });
        };

        const fetchBlock = limit(async (bn) => {
            try {
                return await this.makeRpcCall('eth_getBlockByNumber', [`0x${bn.toString(16)}`, true]);
            } catch {
                return null;
            }
        });

        const results = await Promise.all(blocks.map(b => fetchBlock(b)));
        results.filter(Boolean).forEach(block => {
            (block.transactions || []).forEach(tx => {
                if (tx.to && tx.to.toLowerCase() === this.contractAddress.toLowerCase()) {
                    txs.push({
                        from: tx.from,
                        to: tx.to,
                        hash: tx.hash,
                        blockNumber: parseInt(tx.blockNumber, 16)
                    });
                }
            });
        });
        return txs;
    }

    async getTransactionDetails(logs) {
        const uniqueTxHashes = [...new Set(logs.map(log => log.transactionHash))];

        // Prosty limiter współbieżności (podobny do p-limit)
        const createLimiter = (concurrency) => {
            const queue = [];
            let activeCount = 0;

            const next = () => {
                activeCount--;
                if (queue.length > 0) {
                    const fn = queue.shift();
                    fn();
                }
            };

            return (fn) => new Promise((resolve, reject) => {
                const run = () => {
                    activeCount++;
                    Promise.resolve(fn()).then(resolve).catch(reject).finally(next);
                };

                if (activeCount < concurrency) {
                    run();
                } else {
                    queue.push(run);
                }
            });
        };

        const limit = createLimiter(5); // limit równoległych zapytań

        const txPromises = uniqueTxHashes.map((txHash) =>
            limit(async () => {
                try {
                    return await this.makeRpcCall('eth_getTransactionByHash', [txHash]);
                } catch (error) {
                    console.error(`Błąd pobierania transakcji ${txHash}:`, error.message);
                    return null;
                }
            })
        );

        const settled = await Promise.allSettled(txPromises);

        return settled
            .filter(res => res.status === 'fulfilled' && res.value && res.value.to && res.value.to.toLowerCase() === this.contractAddress.toLowerCase())
            .map(res => ({
                from: res.value.from,
                to: res.value.to,
                hash: res.value.hash,
                blockNumber: parseInt(res.value.blockNumber, 16)
            }));
    }

    async makeRpcCall(method, params) {
        let lastError = null;

        // Try each RPC endpoint
        for (let i = 0; i < this.rpcEndpoints.length; i++) {
            const rpcIndex = (this.currentRpcIndex + i) % this.rpcEndpoints.length;
            const rpcUrl = this.rpcEndpoints[rpcIndex];

            try {
                console.log(`🔗 Próbuję RPC ${rpcIndex + 1}/${this.rpcEndpoints.length}: ${rpcUrl.substring(0, 40)}...`);
                
                const response = await fetch(rpcUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        jsonrpc: '2.0',
                        id: Date.now(),
                        method: method,
                        params: params
                    })
                });

                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                }

                const data = await response.json();

                if (data.error) {
                    throw new Error(`RPC Error: ${data.error.message || data.error.code}`);
                }

                if (!data.result && data.result !== 0 && data.result !== '0x0') {
                    throw new Error('Brak wyniku w odpowiedzi RPC');
                }

                // Success - remember this endpoint works
                this.currentRpcIndex = rpcIndex;
                return data.result;

            } catch (error) {
                console.log(`❌ RPC ${rpcIndex + 1} nie działa (${method}): ${error.message}`);
                lastError = new Error(`RPC ${rpcUrl} (${method}): ${error.message}`);

                // Add delay before trying next endpoint
                await new Promise(resolve => setTimeout(resolve, 200));
            }
        }

        // All endpoints failed
        throw new Error(`Wszystkie RPC endpoints nie działają. Ostatni błąd: ${lastError?.message}`);
    }

    async fetchAllTransactions() {
        if (this.lastFetchedBlock === 0) {
            try {
                return await this.fetchHistoricalTransactions();
            } catch (error) {
                console.warn('⚠️ Błąd pobierania historii z Moonscanu, przełączam na RPC:', error.message);
            }
        }

        return await this.fetchTransactionsWithRPC();
    }

    processTransactions(transactions) {
        const newData = new Map();
        transactions.forEach(tx => {
            // Wszystkie transakcje z RPC są już przefiltrowane (tylko do naszego kontraktu)
            const fromAddress = tx.from.toLowerCase();
            const current = newData.get(fromAddress) || 0;
            newData.set(fromAddress, current + 1);
        });
        return newData;
    }

    prepareDisplayData() {
        const query = this.searchQuery.toLowerCase();
        this.displayData = Array.from(this.transactionData.entries())
            .filter(([address]) => address.toLowerCase().includes(query))
            .map(([address, txCount]) => ({
                address,
                txCount,
                rank: 0
            }));

        this.sortData();
    }

    sortBy(column) {
        if (this.sortColumn === column) {
            this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
        } else {
            this.sortColumn = column;
            this.sortDirection = column === 'txCount' ? 'desc' : 'asc';
        }

        this.updateSortIndicators();
        this.sortData();
        this.displayTable();
    }

    updateSortIndicators() {
        document.querySelectorAll('.sort-indicator').forEach(indicator => {
            indicator.textContent = '';
        });

        let activeHeader;
        switch (this.sortColumn) {
            case 'rank':
                activeHeader = this.elements.rankHeader;
                break;
            case 'address':
                activeHeader = this.elements.addressHeader;
                break;
            case 'txCount':
                activeHeader = this.elements.txCountHeader;
                break;
        }

        if (activeHeader) {
            const indicator = activeHeader.querySelector('.sort-indicator');
            indicator.textContent = this.sortDirection === 'asc' ? '↑' : '↓';
        }
    }

    sortData() {
        this.displayData.sort((a, b) => {
            let comparison = 0;
            
            switch (this.sortColumn) {
                case 'rank':
                    comparison = a.rank - b.rank;
                    break;
                case 'address':
                    comparison = a.address.localeCompare(b.address);
                    break;
                case 'txCount':
                    comparison = a.txCount - b.txCount;
                    break;
            }

            return this.sortDirection === 'asc' ? comparison : -comparison;
        });

        // Aktualizuj rangi po sortowaniu
        this.displayData.forEach((item, index) => {
            item.rank = index + 1;
        });
    }

    displayTable() {
        const start = (this.currentPage - 1) * this.itemsPerPage;
        const end = start + this.itemsPerPage;
        const pageData = this.displayData.slice(start, end);

        if (pageData.length === 0) {
            this.elements.tableBody.innerHTML = `
                <tr>
                    <td colspan="3" class="empty-state">Brak transakcji do wyświetlenia</td>
                </tr>
            `;
        } else {
            this.elements.tableBody.innerHTML = pageData.map(item => `
                <tr>
                    <td class="rank">${item.rank}</td>
                    <td class="address">${item.address}</td>
                    <td class="tx-count">${item.txCount.toLocaleString()}</td>
                </tr>
            `).join('');
        }

        this.updatePagination();
    }

    updatePagination() {
        const maxPages = Math.ceil(this.displayData.length / this.itemsPerPage);
        this.elements.pageInfo.textContent = maxPages > 0 ? `Strona ${this.currentPage} z ${maxPages}` : 'Strona 0 z 0';
        this.elements.prevPage.disabled = this.currentPage === 1 || maxPages === 0;
        this.elements.nextPage.disabled = this.currentPage >= maxPages || maxPages === 0;
    }

    updateMetrics() {
        const uniqueCount = this.transactionData.size;
        const totalTx = Array.from(this.transactionData.values()).reduce((sum, count) => sum + count, 0);
        const now = new Date().toISOString().replace('T', ' ').substring(0, 19);

        this.elements.uniqueAddresses.textContent = uniqueCount.toLocaleString();
        this.elements.totalTransactions.textContent = totalTx.toLocaleString();
        this.elements.lastUpdate.textContent = now;
    }
}

// Uruchom monitor po załadowaniu strony
document.addEventListener('DOMContentLoaded', () => {
    new MoonbeamContractMonitor();
});
