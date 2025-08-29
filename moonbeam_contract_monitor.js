const DATA_VERSION = 2;
const DEFAULT_DEPLOY_BLOCK = 11354233;

class MoonbeamContractMonitor {
    constructor() {
        this.contractAddress = '0x86c66061a0e55d91c8bfa464fe84dc58f8733253';
        this.rpcEndpoints = [
            'https://moonbeam.blastapi.io/0c196ae8-5d7c-4dc7-81b0-dcf08ddebddc',
            'https://rpc.api.moonbeam.network',
            'https://moonbeam.unitedbloc.com:2000',
            'https://rpc.ankr.com/moonbeam',
            'https://1rpc.io/glmr'
        ];
        this.wssEndpoint = 'wss://moonbeam.blastapi.io/0c196ae8-5d7c-4dc7-81b0-dcf08ddebddc';
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
        this.lastFetchedBlock = 0;
        this.contractCreationBlock = 0;
        this.filterFailedTxs = true;

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
            failedFilterToggle: document.getElementById('failedFilterToggle'),
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
        this.elements.failedFilterToggle.classList.toggle('active', this.filterFailedTxs);
    }

    setupEventListeners() {
        this.elements.autoRefreshToggle.addEventListener('click', () => {
            this.toggleAutoRefresh();
        });

        this.elements.failedFilterToggle.addEventListener('click', () => {
            this.toggleFailedFilter();
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

    toggleFailedFilter() {
        this.filterFailedTxs = !this.filterFailedTxs;
        this.elements.failedFilterToggle.classList.toggle('active', this.filterFailedTxs);

        this.transactionData.clear();
        this.lastFetchedBlock = 0;
        this.saveState();
        this.prepareDisplayData();
        this.displayTable();
        this.updateMetrics();
        this.loadTransactionData();
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

            const savedCreationBlock = localStorage.getItem('contractCreationBlock');
            if (savedCreationBlock) {
                const block = parseInt(savedCreationBlock, 10);
                if (!isNaN(block)) {
                    this.contractCreationBlock = block;
                }
            }

            const savedFilter = localStorage.getItem('filterFailedTxs');
            if (savedFilter !== null) {
                this.filterFailedTxs = savedFilter === '1';
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
            localStorage.setItem('contractCreationBlock', this.contractCreationBlock.toString());
            localStorage.setItem('filterFailedTxs', this.filterFailedTxs ? '1' : '0');
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
            const total = Array.from(this.transactionData.values()).reduce((sum, counts) => sum + counts.total, 0);
            this.elements.statusText.textContent = `${count} adresów, ${total} transakcji`;
        }
    }

    async loadTransactionData() {
        this.setLoading(true);
        this.hideError();

        try {
            const allTransactions = await this.fetchAllTransactions();
            const newData = this.processTransactions(allTransactions);
            newData.forEach((counts, address) => {
                const current = this.transactionData.get(address) || { total: 0, failed: 0 };
                this.transactionData.set(address, {
                    total: current.total + counts.total,
                    failed: current.failed + counts.failed
                });
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
                    const message = (data.message || data.result || 'Unknown Moonscan error');
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
        if (this.contractCreationBlock) {
            return this.contractCreationBlock;
        }

        try {
            const params = new URLSearchParams({
                module: 'contract',
                action: 'getcontractcreation',
                contractaddresses: this.contractAddress
            });
            if (this.moonscanApiKey) {
                params.append('apikey', this.moonscanApiKey);
            }

            const result = await this.makeMoonscanRequest(params);
            if (Array.isArray(result) && result.length > 0 && result[0].txHash) {
                const txHash = result[0].txHash;
                const receipt = await this.makeRpcCall('eth_getTransactionReceipt', [txHash]);
                if (receipt && receipt.blockNumber) {
                    const block = parseInt(receipt.blockNumber, 16);
                    if (!isNaN(block)) {
                        this.contractCreationBlock = block;
                        localStorage.setItem('contractCreationBlock', block.toString());
                        return block;
                    }
                }
            }
        } catch (error) {
            console.warn('Nie udało się pobrać bloku tworzenia kontraktu:', error.message);
        }

        this.contractCreationBlock = DEFAULT_DEPLOY_BLOCK;
        return DEFAULT_DEPLOY_BLOCK;
    }

    /**
     * Pobiera pełną historię transakcji (zewnętrznych i wewnętrznych) z Moonscanu.
     */
    async fetchHistoricalTransactions() {
        const startBlock = await this.getContractCreationBlock();
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
                .filter(tx => {
                    if (!tx.to || tx.to.toLowerCase() !== this.contractAddress.toLowerCase()) return false;
                    const failed = !(tx.isError === '0' && (!tx.txreceipt_status || tx.txreceipt_status === '1'));
                    return this.filterFailedTxs ? !failed : true;
                })
                .map(tx => ({
                    from: tx.from,
                    to: tx.to,
                    hash: tx.hash,
                    blockNumber: parseInt(tx.blockNumber),
                    failed: !(tx.isError === '0' && (!tx.txreceipt_status || tx.txreceipt_status === '1'))
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
                // trace_filter zwraca pełne informacje o transakcjach i wewnętrznych wywołaniach
                const traces = await this.makeRpcCall('trace_filter', [{
                    fromBlock: `0x${currentFromBlock.toString(16)}`,
                    toBlock: `0x${batchToBlock.toString(16)}`,
                    toAddress: [this.contractAddress]
                }]);

                const uniqueTxs = new Map();
                (traces || []).forEach(trace => {
                    if (!trace || !trace.transactionHash || !trace.action) return;
                    const existing = uniqueTxs.get(trace.transactionHash);
                    const failed = !!trace.error;
                    if (existing) {
                        if (!existing.failed && failed) {
                            existing.failed = true;
                        }
                        return;
                    }
                    uniqueTxs.set(trace.transactionHash, {
                        from: trace.action.from,
                        to: trace.action.to,
                        hash: trace.transactionHash,
                        blockNumber: parseInt(trace.blockNumber, 16),
                        failed
                    });
                });

                const txs = [...uniqueTxs.values()].filter(tx => this.filterFailedTxs ? !tx.failed : true);
                if (txs.length > 0) {
                    transactions.push(...txs);
                    console.log(`✅ Znaleziono ${txs.length} unikalnych transakcji`);
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

                // Fallback na Moonscan, gdy trace_filter zawiedzie
                try {
                    const baseParams = {
                        address: this.contractAddress,
                        startblock: currentFromBlock.toString(),
                        endblock: batchToBlock.toString(),
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
                        .filter(tx => {
                            if (!tx.to || tx.to.toLowerCase() !== this.contractAddress.toLowerCase()) return false;
                            const failed = !(tx.isError === '0' && (!tx.txreceipt_status || tx.txreceipt_status === '1'));
                            return this.filterFailedTxs ? !failed : true;
                        })
                        .map(tx => ({
                            from: tx.from,
                            to: tx.to,
                            hash: tx.hash,
                            blockNumber: parseInt(tx.blockNumber),
                            failed: !(tx.isError === '0' && (!tx.txreceipt_status || tx.txreceipt_status === '1'))
                        }));

                    const fallbackTxs = new Map();
                    [...parseTxs(ext), ...parseTxs(internal)].forEach(tx => {
                        const existing = fallbackTxs.get(tx.hash);
                        if (existing) {
                            if (!existing.failed && tx.failed) {
                                existing.failed = true;
                                fallbackTxs.set(tx.hash, existing);
                            }
                            return;
                        }
                        fallbackTxs.set(tx.hash, tx);
                    });

                    const txs = [...fallbackTxs.values()].filter(tx => this.filterFailedTxs ? !tx.failed : true);
                    if (txs.length > 0) {
                        transactions.push(...txs);
                        console.log(`✅ (Moonscan) Znaleziono ${txs.length} unikalnych transakcji`);
                    } else {
                        console.log(`⏭️  Brak transakcji w blokach ${currentFromBlock} - ${batchToBlock}`);
                    }
                } catch (msError) {
                    console.error('❌ Moonscan fallback failed:', msError.message);
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
            const fromAddress = tx.from.toLowerCase();
            const current = newData.get(fromAddress) || { total: 0, failed: 0 };
            current.total += 1;
            if (tx.failed) {
                current.failed += 1;
            }
            newData.set(fromAddress, current);
        });
        return newData;
    }

    prepareDisplayData() {
        const query = this.searchQuery.toLowerCase();
        this.displayData = Array.from(this.transactionData.entries())
            .filter(([address]) => address.toLowerCase().includes(query))
            .map(([address, counts]) => ({
                address,
                txCount: counts.total,
                failedCount: counts.failed,
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
                    <td class="tx-count">${item.txCount.toLocaleString()}${item.failedCount ? ` <span class="failed-tx">(${item.failedCount.toLocaleString()} bł.)</span>` : ''}</td>
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
        const totalTx = Array.from(this.transactionData.values()).reduce((sum, counts) => sum + counts.total, 0);
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
