const DATA_VERSION = 1;

class MoonbeamContractMonitor {
    constructor() {
        this.contractAddress = '0x86c66061a0e55d91c8bfa464fe84dc58f8733253';
        this.rpcEndpoints = [
            'https://rpc.api.moonbeam.network',
            'https://moonbeam.blastapi.io/b8a802c6-651e-4cf0-a151-6ecbd1a18b9d',
            'https://moonbeam.unitedbloc.com:2000',
            'https://rpc.ankr.com/moonbeam',
            'https://1rpc.io/glmr'
        ];
        this.currentRpcIndex = 0;
        this.wsRpcEndpoints = [
            'wss://wss.api.moonbeam.network',
            'wss://moonbeam.public.blastapi.io',
            'wss://moonbeam.unitedbloc.com:2001'
        ];
        this.webSocket = null;

        // Moonscan API configuration (set via localStorage: moonscanApiKey)
        this.moonscanApiKey = localStorage.getItem('moonscanApiKey') || '';
        this.moonscanRateLimit = 5; // requests per second
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
        this.startWebSocketListener();
        if (this.autoRefreshEnabled) {
            this.startAutoRefresh();
        }
    }

    startWebSocketListener() {
        if (!('WebSocket' in window)) {
            console.warn('WebSocket not supported in this browser.');
            return;
        }

        let index = 0;
        const connect = () => {
            if (index >= this.wsRpcEndpoints.length) {
                console.warn('Wszystkie WebSocket endpoints są niedostępne');
                return;
            }

            const url = this.wsRpcEndpoints[index++];
            console.log(`\uD83D\uDD0C Próba połączenia WebSocket: ${url}`);
            const ws = new WebSocket(url);

            ws.onopen = () => {
                console.log(`\u2705 Połączono z WebSocket: ${url}`);
                ws.send(JSON.stringify({
                    jsonrpc: '2.0',
                    id: Date.now(),
                    method: 'eth_subscribe',
                    params: ['logs', { address: this.contractAddress }]
                }));
            };

            ws.onmessage = async (event) => {
                try {
                    const message = JSON.parse(event.data);
                    if (message.method === 'eth_subscription' && message.params?.result) {
                        const log = message.params.result;
                        try {
                            const tx = await this.makeRpcCall('eth_getTransactionByHash', [log.transactionHash]);
                            if (tx && tx.to && tx.to.toLowerCase() === this.contractAddress.toLowerCase()) {
                                const from = tx.from.toLowerCase();
                                const current = this.transactionData.get(from) || 0;
                                this.transactionData.set(from, current + 1);
                                const blockNumber = parseInt(tx.blockNumber, 16);
                                if (blockNumber > this.lastFetchedBlock) {
                                    this.lastFetchedBlock = blockNumber;
                                }
                                this.prepareDisplayData();
                                this.displayTable();
                                this.updateMetrics();
                                this.saveState();
                            }
                        } catch (err) {
                            console.error('Błąd pobierania transakcji WebSocket:', err);
                        }
                    }
                } catch (err) {
                    console.error('Błąd przetwarzania wiadomości WebSocket:', err);
                }
            };

            ws.onerror = (err) => {
                console.error('Błąd WebSocket:', err);
            };

            ws.onclose = () => {
                console.warn('WebSocket zamknięty, ponawiam próbę za 5s');
                setTimeout(connect, 5000);
            };

            this.webSocket = ws;
        };

        connect();
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
        const baseUrl = 'https://api-moonbeam.moonscan.io/api';
        const maxRetries = 5;

        for (let attempt = 0; attempt < maxRetries; attempt++) {
            try {
                const now = Date.now();
                const delay = Math.max(0, (1000 / this.moonscanRateLimit) - (now - this.moonscanLastRequest));
                if (delay > 0) {
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
                this.moonscanLastRequest = Date.now();

                const url = `${baseUrl}?${params.toString()}`;
                const response = await fetch(url);
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}`);
                }

                const data = await response.json();
                if (data.status !== '1') {
                    let message = '';
                    if (typeof data.result === 'string' && data.result && data.result.toUpperCase() !== 'NOTOK') {
                        message = data.result;
                    } else if (typeof data.message === 'string' && data.message.toUpperCase() !== 'NOTOK') {
                        message = data.message;
                    }
                    if (!message) {
                        message = 'Unknown Moonscan error';
                    }
                    if (message.toLowerCase().includes('max rate limit')) {
                        const backoff = (attempt + 1) * 1000;
                        console.warn(`⚠️ Moonscan rate limit reached, retrying in ${backoff}ms`);
                        await new Promise(resolve => setTimeout(resolve, backoff));
                        continue;
                    }
                    throw new Error(message);
                }

                return data.result;
            } catch (error) {
                console.error('Moonscan API error:', error.message);
                if (attempt === maxRetries - 1) {
                    throw error;
                }
            }
        }

        return [];
    }

    /**
     * Ustala blok startowy na podstawie transakcji tworzącej kontrakt.
     */
    async getContractCreationBlock() {
        const params = new URLSearchParams({
            module: 'contract',
            action: 'getcontractcreation',
            contractaddresses: this.contractAddress
        });
        if (this.moonscanApiKey) {
            params.append('apikey', this.moonscanApiKey);
        }

        try {
            const result = await this.makeMoonscanRequest(params);
            const info = Array.isArray(result) ? result[0] : result;
            const block = parseInt(info?.blockNumber || '0', 10);
            if (!block) {
                throw new Error('Contract creation block not found');
            }
            return block;
        } catch (error) {
            console.warn('⚠️ Nie udało się pobrać bloku utworzenia kontraktu z Moonscanu:', error.message);
            return 0;
        }
    }

    /**
     * Pobiera pełną historię transakcji (zewnętrznych i wewnętrznych) z Moonscanu.
     */
    async fetchHistoricalTransactions() {
        const startBlock = await this.getContractCreationBlock();
        if (startBlock === 0) {
            throw new Error('Cannot determine contract creation block');
        }

        const latestBlockHex = await this.makeRpcCall('eth_blockNumber', []);
        const latestBlock = parseInt(latestBlockHex, 16);

        const step = 10000; // limit Moonscan API
        let fromBlock = startBlock;
        const allTxs = [];
        const seen = new Set();

        while (fromBlock <= latestBlock) {
            const toBlock = Math.min(fromBlock + step - 1, latestBlock);

            const baseParams = {
                address: this.contractAddress,
                startblock: fromBlock.toString(),
                endblock: toBlock.toString(),
                sort: 'asc'
            };
            const extParams = new URLSearchParams({ module: 'account', action: 'txlist', ...baseParams });
            const intParams = new URLSearchParams({ module: 'account', action: 'txlistinternal', ...baseParams });
            if (this.moonscanApiKey) {
                extParams.append('apikey', this.moonscanApiKey);
                intParams.append('apikey', this.moonscanApiKey);
            }

            const [ext, internal] = await Promise.all([
                this.makeMoonscanRequest(extParams),
                this.makeMoonscanRequest(intParams)
            ]);

            const parseTxs = (list) => (list || [])
                .filter(tx => tx.to && tx.to.toLowerCase() === this.contractAddress.toLowerCase() && tx.isError === '0' && (!tx.txreceipt_status || tx.txreceipt_status === '1'))
                .map(tx => ({
                    from: tx.from,
                    to: tx.to,
                    hash: tx.hash,
                    blockNumber: parseInt(tx.blockNumber)
                }));

            [...parseTxs(ext), ...parseTxs(internal)].forEach(tx => {
                if (!seen.has(tx.hash)) {
                    seen.add(tx.hash);
                    allTxs.push(tx);
                }
            });

            fromBlock = toBlock + 1;
        }

        this.lastFetchedBlock = latestBlock;
        return allTxs;
    }

    async fetchTransactionsWithRPC() {
        const transactions = [];
        // Rozmiar batch jest dynamiczny, zmniejszany przy błędach aby odciążyć RPC
        let batchSize = 5000; // Reasonable batch size

        console.log('🔍 Pobieranie transakcji z Moonbeam RPC...');

        // Get current block number first
        const latestBlockHex = await this.makeRpcCall('eth_blockNumber', []);
        const latestBlock = parseInt(latestBlockHex, 16);
        console.log(`📊 Najnowszy blok: ${latestBlock}`);

        const fromBlock = this.lastFetchedBlock + 1;
        if (fromBlock > latestBlock) {
            console.log('⏭️  Brak nowych bloków do pobrania');
            return transactions;
        }

        let currentFromBlock = fromBlock;
        while (currentFromBlock <= latestBlock) {
            const batchToBlock = Math.min(currentFromBlock + batchSize - 1, latestBlock);

            console.log(`📦 Pobieranie bloków ${currentFromBlock} - ${batchToBlock}`);

            try {
                const logs = await this.makeRpcCall('eth_getLogs', [{
                    fromBlock: `0x${currentFromBlock.toString(16)}`,
                    toBlock: `0x${batchToBlock.toString(16)}`,
                    address: this.contractAddress
                }]);

                if (logs && logs.length > 0) {
                    // Dla każdego loga, pobierz szczegóły transakcji
                    const batchTxs = await this.getTransactionDetails(logs);
                    transactions.push(...batchTxs);
                    console.log(`✅ Znaleziono ${logs.length} logów, ${batchTxs.length} unikalnych transakcji`);
                } else {
                    console.log(`⏭️  Brak transakcji w blokach ${currentFromBlock} - ${batchToBlock}`);
                }

            } catch (error) {
                console.error(`❌ Błąd dla bloków ${currentFromBlock} - ${batchToBlock}:`, error.message);
                // Try smaller batch on error and ensure it never goes below 1000
                if (error.message.includes('query returned more than')) {
                    console.log('📉 Zmniejszam rozmiar batch...');
                    batchSize = Math.max(1000, Math.floor(batchSize / 2)); // dziel rozmiar przez 2, min. 1000
                    continue;
                }
            }

            currentFromBlock = batchToBlock + 1;

            // Add delay to avoid rate limiting
            await new Promise(resolve => setTimeout(resolve, 100));

            // Safety break for very large chains
            if (currentFromBlock > fromBlock + 50000) {
                console.log('🛑 Osiągnięto limit bezpieczeństwa (50k bloków)');
                break;
            }
        }

        this.lastFetchedBlock = latestBlock;
        console.log(`🎉 Pobieranie zakończone: ${transactions.length} unikalnych transakcji`);
        return transactions;
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
