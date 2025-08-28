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
        
        this.initializeElements();
        this.setupEventListeners();
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
            addressSearch: document.getElementById('addressSearch')
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
            this.processTransactions(allTransactions);
            this.prepareDisplayData();
            this.displayTable();
            this.updateMetrics();
            
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

    async fetchTransactionsWithMoonscan() {
        const baseUrl = 'https://api-moonbeam.moonscan.io/api';
        const params = new URLSearchParams({
            module: 'account',
            action: 'txlist',
            address: this.contractAddress,
            startblock: '0',
            endblock: '99999999',
            sort: 'asc'
        });

        if (this.moonscanApiKey) {
            params.append('apikey', this.moonscanApiKey);
        }

        const maxRetries = 5;

        for (let attempt = 0; attempt < maxRetries; attempt++) {
            try {
                const now = Date.now();
                const delay = Math.max(0, (1000 / this.moonscanRateLimit) - (now - this.moonscanLastRequest));
                if (delay > 0) {
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
                this.moonscanLastRequest = Date.now();

                const response = await fetch(`${baseUrl}?${params.toString()}`);
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}`);
                }

                const data = await response.json();

                if (data.status !== '1') {
                    const message = (data.message || data.result || 'Unknown Moonscan error');
                    if (message.toLowerCase().includes('max rate limit')) {
                        const backoff = (attempt + 1) * 1000;
                        console.warn(`⚠️ Moonscan rate limit reached, retrying in ${backoff}ms`);
                        await new Promise(resolve => setTimeout(resolve, backoff));
                        continue;
                    }
                    throw new Error(message);
                }

                const txs = data.result
                    .filter(tx => tx.to && tx.to.toLowerCase() === this.contractAddress.toLowerCase())
                    .map(tx => ({
                        from: tx.from,
                        to: tx.to,
                        hash: tx.hash,
                        blockNumber: parseInt(tx.blockNumber)
                    }));

                console.log(`🔍 Pobieranie transakcji z Moonscan API: ${txs.length}`);
                return txs;
            } catch (error) {
                console.error('Moonscan API error:', error.message);
                if (attempt === maxRetries - 1) {
                    throw error;
                }
            }
        }

        return [];
    }

    async fetchTransactionsWithRPC() {
        const transactions = [];
        let fromBlock = 0;
        const toBlock = 'latest';
        // Rozmiar batch jest dynamiczny, zmniejszany przy błędach aby odciążyć RPC
        let batchSize = 5000; // Reasonable batch size
        let currentFromBlock = fromBlock;
        
        console.log('🔍 Pobieranie transakcji z Moonbeam RPC...');
        
        // Get current block number first
        const latestBlockHex = await this.makeRpcCall('eth_blockNumber', []);
        const latestBlock = parseInt(latestBlockHex, 16);
        console.log(`📊 Najnowszy blok: ${latestBlock}`);

        while (currentFromBlock < latestBlock) {
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
        try {
            const moonscanTxs = await this.fetchTransactionsWithMoonscan();
            if (moonscanTxs && moonscanTxs.length > 0) {
                return moonscanTxs;
            }
            console.log('ℹ️ Brak danych z Moonscanu, przełączam na RPC');
        } catch (error) {
            console.warn('⚠️ Błąd Moonscan, przełączam na RPC:', error.message);
        }

        return await this.fetchTransactionsWithRPC();
    }

    processTransactions(transactions) {
        this.transactionData.clear();

        transactions.forEach(tx => {
            // Wszystkie transakcje z RPC są już przefiltrowane (tylko do naszego kontraktu)
            const fromAddress = tx.from.toLowerCase();
            const current = this.transactionData.get(fromAddress) || 0;
            this.transactionData.set(fromAddress, current + 1);
        });
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
