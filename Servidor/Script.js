(function () {
  // Chaves de armazenamento e estado mantido durante o uso da aplicacao.
  const ITEMS_KEY = 'estoque-contagem-v1';
  const PRODUCTS_KEY = 'estoque-produtos-v1';
  let items = [];
  let products = [];
  let pendingBarcode = null;
  let html5QrCode = null;
  let camRunning = false;
  let lastCamScan = { code: null, time: 0 };
  let toastTimer = null;

  // Funcoes de normalizacao e carregamento dos dados salvos no navegador.
  function normalize(s) {
    return (s || '').trim().toLowerCase();
  }

  function loadAll() {
    try {
      const rawItems = localStorage.getItem(ITEMS_KEY);
      items = rawItems ? JSON.parse(rawItems) : [];
      if (!Array.isArray(items)) items = [];
    } catch (e) {
      console.error('Falha ao carregar contagem:', e);
      items = [];
    }

    try {
      const rawProd = localStorage.getItem(PRODUCTS_KEY);
      products = rawProd ? JSON.parse(rawProd) : [];
      if (!Array.isArray(products)) products = [];
    } catch (e) {
      console.error('Falha ao carregar produtos:', e);
      products = [];
    }
  }

  // Persistencia local das contagens e dos produtos cadastrados.
  function saveItems() {
    try {
      localStorage.setItem(ITEMS_KEY, JSON.stringify(items));
    } catch (e) {
      console.error(e);
      showToast('Não foi possível salvar a contagem.');
    }
  }

  function saveProducts() {
    try {
      localStorage.setItem(PRODUCTS_KEY, JSON.stringify(products));
    } catch (e) {
      console.error(e);
      showToast('Não foi possível salvar os produtos.');
    }
  }

  // Consultas aos dados e exibicao de notificacoes temporarias.
  function findItemByBarcode(code) {
    return items.find(i => i.barcode && i.barcode === code);
  }

  function findItemByName(name) {
    return items.find(i => normalize(i.name) === normalize(name));
  }

  function findProductByBarcode(code) {
    return products.find(p => p.barcode === code);
  }

  function showToast(msg) {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
  }

  // Inclusao, alteracao e remocao de itens da contagem.
  function addItem(name, qty, barcode) {
    name = (name || '').trim();
    if (!name) return;
    qty = Math.max(1, Math.round(qty) || 1);

    let existing = barcode ? findItemByBarcode(barcode) : null;
    if (!existing) existing = findItemByName(name);

    if (existing) {
      existing.qty += qty;
      existing.updated = Date.now();
      if (barcode && !existing.barcode) existing.barcode = barcode;
      showToast(`"${existing.name}" atualizado — +${qty} (total: ${existing.qty})`);
    } else {
      items.push({
        id: 'i' + Date.now() + Math.random().toString(36).slice(2, 7),
        name,
        qty,
        barcode: barcode || null,
        updated: Date.now()
      });
      showToast(`"${name}" adicionado à contagem (${qty})`);
    }

    saveItems();
    renderItems();
  }

  function changeQty(id, delta) {
    const it = items.find(i => i.id === id);
    if (!it) return;
    it.qty = Math.max(0, it.qty + delta);
    it.updated = Date.now();
    saveItems();
    renderItems();
  }

  function removeItem(id) {
    items = items.filter(i => i.id !== id);
    saveItems();
    renderItems();
  }

  function clearAll() {
    if (items.length === 0) return;
    if (!confirm('Isso vai apagar todos os itens da contagem (os produtos cadastrados continuam salvos). Continuar?')) return;
    items = [];
    saveItems();
    renderItems();
    showToast('Contagem zerada.');
  }

  // Inclusao e remocao de produtos no banco local.
  function addProduct(barcode, name, { silent } = {}) {
    barcode = (barcode || '').trim();
    name = (name || '').trim();
    if (!barcode || !name) return null;

    let existing = findProductByBarcode(barcode);
    if (existing) {
      existing.name = name;
      if (!silent) showToast(`Produto do código ${barcode} atualizado.`);
    } else {
      existing = { barcode, name, createdAt: Date.now() };
      products.push(existing);
      if (!silent) showToast(`Produto "${name}" cadastrado.`);
    }

    saveProducts();
    renderProducts();
    return existing;
  }

  function removeProduct(barcode) {
    products = products.filter(p => p.barcode !== barcode);
    saveProducts();
    renderProducts();
  }

  // Identificacao do codigo lido e cadastro rapido de codigos novos.
  function handleBarcodeScan(code) {
    code = (code || '').trim();
    if (!code) return;

    const existingItem = findItemByBarcode(code);
    if (existingItem) {
      changeQty(existingItem.id, 1);
      showToast(`"${existingItem.name}" +1 (código ${code})`);
      hideRegisterBox();
      return;
    }

    const product = findProductByBarcode(code);
    if (product) {
      addItem(product.name, 1, code);
      hideRegisterBox();
      return;
    }

    showRegisterBox(code);
  }

  function showRegisterBox(code) {
    const registerBox = document.getElementById('registerBox');
    const chip = document.getElementById('registerCodeChip');
    const input = document.getElementById('registerNameInput');
    if (!registerBox || !chip || !input) return;

    pendingBarcode = code;
    chip.textContent = code;
    registerBox.classList.add('show');
    input.value = '';
    input.focus();
  }

  function hideRegisterBox() {
    const registerBox = document.getElementById('registerBox');
    if (!registerBox) return;
    pendingBarcode = null;
    registerBox.classList.remove('show');
  }

  // Inicializacao, leitura e encerramento da camera do dispositivo.
  function toggleCamera() {
    if (camRunning) {
      stopCamera();
      return;
    }
    startCamera();
  }

  function startCamera() {
    const errEl = document.getElementById('camError');
    const readerEl = document.getElementById('camReader');
    const camToggleBtn = document.getElementById('camToggleBtn');
    if (!errEl || !readerEl || !camToggleBtn) return;

    errEl.classList.remove('show');
    if (typeof Html5Qrcode === 'undefined') {
      errEl.textContent = 'Não foi possível carregar a biblioteca de câmera. Use o campo de leitura manual acima.';
      errEl.classList.add('show');
      return;
    }

    readerEl.classList.add('show');
    html5QrCode = new Html5Qrcode('camReader', {
      formatsToSupport: [
        Html5QrcodeSupportedFormats.EAN_13,
        Html5QrcodeSupportedFormats.EAN_8,
        Html5QrcodeSupportedFormats.UPC_A,
        Html5QrcodeSupportedFormats.UPC_E,
        Html5QrcodeSupportedFormats.CODE_128,
        Html5QrcodeSupportedFormats.CODE_39,
        Html5QrcodeSupportedFormats.CODABAR,
        Html5QrcodeSupportedFormats.ITF,
        Html5QrcodeSupportedFormats.QR_CODE
      ],
      verbose: false
    });

    html5QrCode.start(
      { facingMode: 'environment' },
      { fps: 10, qrbox: { width: 260, height: 150 } },
      (decodedText) => {
        const now = Date.now();
        if (lastCamScan.code === decodedText && now - lastCamScan.time < 2500) return;
        lastCamScan = { code: decodedText, time: now };
        handleBarcodeScan(decodedText);
      },
      () => {}
    ).then(() => {
      camRunning = true;
      camToggleBtn.textContent = '✕ Fechar câmera';
    }).catch((err) => {
      console.error('Erro ao iniciar câmera:', err);
      readerEl.classList.remove('show');
      errEl.textContent = 'Não foi possível acessar a câmera (permissão negada ou indisponível neste navegador/ambiente). Abra a página publicada diretamente no navegador e permita o acesso, ou use um leitor físico no campo acima.';
      errEl.classList.add('show');
    });
  }

  function stopCamera() {
    const readerEl = document.getElementById('camReader');
    const camToggleBtn = document.getElementById('camToggleBtn');
    if (!readerEl || !camToggleBtn) return;

    if (html5QrCode && camRunning) {
      html5QrCode.stop().then(() => {
        html5QrCode.clear();
        readerEl.classList.remove('show');
        camToggleBtn.textContent = '📷 Câmera';
        camRunning = false;
      }).catch(() => {
        readerEl.classList.remove('show');
        camToggleBtn.textContent = '📷 Câmera';
        camRunning = false;
      });
    }
  }

  // Geracao e download da planilha Excel com contagens e produtos.
  async function exportToExcel() {
    const btn = document.getElementById('exportExcelBtn');
    if (!btn) return;

    if (typeof XLSX === 'undefined') {
      showToast('Biblioteca de Excel não carregou. Tente recarregar a página.');
      return;
    }

    if (items.length === 0 && products.length === 0) {
      showToast('Nada para exportar ainda.');
      return;
    }

    const originalLabel = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Gerando...';

    try {
      const wb = XLSX.utils.book_new();

      const itemsRows = [...items]
        .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
        .map(i => ({
          'Item': i.name,
          'Código de Barras': i.barcode || '',
          'Quantidade': i.qty,
          'Última Atualização': i.updated ? new Date(i.updated).toLocaleString('pt-BR') : ''
        }));

      const itemsSheet = XLSX.utils.json_to_sheet(itemsRows);
      itemsSheet['!cols'] = [{ wch: 30 }, { wch: 18 }, { wch: 12 }, { wch: 20 }];
      XLSX.utils.book_append_sheet(wb, itemsSheet, 'Contagem');

      const productsRows = [...products]
        .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
        .map(p => ({
          'Código de Barras': p.barcode,
          'Nome do Produto': p.name,
          'Cadastrado em': p.createdAt ? new Date(p.createdAt).toLocaleString('pt-BR') : ''
        }));

      const productsSheet = XLSX.utils.json_to_sheet(productsRows);
      productsSheet['!cols'] = [{ wch: 18 }, { wch: 30 }, { wch: 20 }];
      XLSX.utils.book_append_sheet(wb, productsSheet, 'Produtos');

      const wbArray = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
      const blob = new Blob([wbArray], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });

      if (window.claude && typeof claude.use === 'function') {
        const downloads = await claude.use('downloads');
        if (downloads) {
          const dateStamp = new Date().toISOString().slice(0, 10);
          const result = await downloads.save({ filename: `contagem-estoque-${dateStamp}.xlsx`, data: blob });
          showToast(result.status === 'saved' ? 'Planilha Excel salva!' : 'Planilha enviada.');
          return;
        }
      }

      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const dateStamp = new Date().toISOString().slice(0, 10);
      link.href = url;
      link.download = `contagem-estoque-${dateStamp}.xlsx`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      showToast('Planilha Excel baixada.');
    } catch (err) {
      console.error('Erro ao exportar Excel:', err);
      showToast('Não foi possível exportar a planilha.');
    } finally {
      btn.disabled = false;
      btn.textContent = originalLabel;
    }
  }

  // Formatacao de horarios e atualizacao dos indicadores da tela.
  function formatTime(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    const pad = n => String(n).padStart(2, '0');
    return pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function renderSummary() {
    const totalItens = document.getElementById('totalItens');
    const totalUnidades = document.getElementById('totalUnidades');
    const totalProdutos = document.getElementById('totalProdutos');

    if (totalItens) totalItens.textContent = items.length;
    if (totalUnidades) totalUnidades.textContent = items.reduce((sum, i) => sum + i.qty, 0);
    if (totalProdutos) totalProdutos.textContent = products.length;
  }

  // Montagem visual da lista de itens contados e seus controles.
  function renderItems() {
    const listEl = document.getElementById('itemsList');
    const emptyEl = document.getElementById('emptyState');
    const searchInput = document.getElementById('searchInput');
    if (!listEl || !searchInput) {
      renderSummary();
      return;
    }

    const filter = normalize(searchInput.value);
    const sorted = [...items].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
    const visible = filter ? sorted.filter(i => normalize(i.name).includes(filter) || (i.barcode || '').includes(filter)) : sorted;

    listEl.innerHTML = '';
    if (items.length === 0) {
      if (emptyEl) {
        emptyEl.style.display = 'block';
        emptyEl.querySelector('strong').textContent = 'Nenhum item ainda';
        emptyEl.lastChild.textContent = 'Escaneie um código ou adicione o primeiro item acima.';
      }
    } else if (visible.length === 0) {
      if (emptyEl) {
        emptyEl.style.display = 'block';
        emptyEl.querySelector('strong').textContent = 'Nada encontrado';
        emptyEl.lastChild.textContent = 'Nenhum item corresponde à busca "' + filter + '".';
      }
    } else if (emptyEl) {
      emptyEl.style.display = 'none';
    }

    visible.forEach(it => {
      const li = document.createElement('li');
      li.className = 'item';

      const nameWrap = document.createElement('div');
      const nameEl = document.createElement('div');
      nameEl.className = 'item-name';
      nameEl.textContent = it.name;

      const metaEl = document.createElement('div');
      metaEl.className = 'item-meta';
      const addedEl = document.createElement('span');
      addedEl.className = 'item-added';
      addedEl.textContent = 'atualizado ' + formatTime(it.updated);
      metaEl.appendChild(addedEl);

      if (it.barcode) {
        const codeEl = document.createElement('span');
        codeEl.className = 'item-barcode';
        codeEl.textContent = it.barcode;
        metaEl.appendChild(codeEl);
      }

      nameWrap.appendChild(nameEl);
      nameWrap.appendChild(metaEl);

      const qtyWrap = document.createElement('div');
      qtyWrap.className = 'qty-control';

      const minus = document.createElement('button');
      minus.type = 'button';
      minus.textContent = '–';
      minus.setAttribute('aria-label', 'Diminuir quantidade de ' + it.name);
      minus.addEventListener('click', () => changeQty(it.id, -1));

      const val = document.createElement('div');
      val.className = 'qty-val';
      val.textContent = it.qty;

      const plus = document.createElement('button');
      plus.type = 'button';
      plus.textContent = '+';
      plus.setAttribute('aria-label', 'Aumentar quantidade de ' + it.name);
      plus.addEventListener('click', () => changeQty(it.id, 1));

      qtyWrap.appendChild(minus);
      qtyWrap.appendChild(val);
      qtyWrap.appendChild(plus);

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'remove-btn';
      removeBtn.textContent = 'remover';
      removeBtn.addEventListener('click', () => removeItem(it.id));

      li.appendChild(nameWrap);
      li.appendChild(qtyWrap);
      li.appendChild(removeBtn);
      listEl.appendChild(li);
    });

    renderSummary();
  }

  // Montagem visual da lista de produtos cadastrados.
  function renderProducts() {
    const listEl = document.getElementById('productsList');
    const emptyEl = document.getElementById('prodEmptyState');
    const searchInput = document.getElementById('prodSearchInput');
    if (!listEl || !searchInput) {
      renderSummary();
      return;
    }

    const filter = normalize(searchInput.value);
    const sorted = [...products].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
    const visible = filter ? sorted.filter(p => normalize(p.name).includes(filter) || p.barcode.includes(filter)) : sorted;

    listEl.innerHTML = '';
    if (products.length === 0) {
      if (emptyEl) emptyEl.style.display = 'block';
    } else if (visible.length === 0) {
      if (emptyEl) {
        emptyEl.style.display = 'block';
        emptyEl.querySelector('strong').textContent = 'Nada encontrado';
        emptyEl.lastChild.textContent = 'Nenhum produto corresponde à busca "' + filter + '".';
      }
    } else if (emptyEl) {
      emptyEl.style.display = 'none';
    }

    visible.forEach(p => {
      const li = document.createElement('li');
      li.className = 'item';

      const nameWrap = document.createElement('div');
      const nameEl = document.createElement('div');
      nameEl.className = 'item-name';
      nameEl.textContent = p.name;

      const metaEl = document.createElement('div');
      metaEl.className = 'item-meta';
      const codeEl = document.createElement('span');
      codeEl.className = 'item-barcode';
      codeEl.textContent = p.barcode;
      metaEl.appendChild(codeEl);

      nameWrap.appendChild(nameEl);
      nameWrap.appendChild(metaEl);

      const spacer = document.createElement('div');
      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'remove-btn';
      removeBtn.textContent = 'remover';
      removeBtn.addEventListener('click', () => removeProduct(p.barcode));

      li.appendChild(nameWrap);
      li.appendChild(spacer);
      li.appendChild(removeBtn);
      listEl.appendChild(li);
    });

    renderSummary();
  }

  // Eventos e acoes disponiveis na tela de contagem.
  function bindCountPage() {
    const barcodeInput = document.getElementById('barcodeInput');
    const addForm = document.getElementById('addForm');
    const searchInput = document.getElementById('searchInput');
    const clearBtn = document.getElementById('clearBtn');
    const exportBtn = document.getElementById('exportExcelBtn');
    const camToggleBtn = document.getElementById('camToggleBtn');
    const registerConfirmBtn = document.getElementById('registerConfirmBtn');
    const registerNameInput = document.getElementById('registerNameInput');
    const registerCancelBtn = document.getElementById('registerCancelBtn');

    if (barcodeInput) {
      barcodeInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          const val = e.target.value;
          e.target.value = '';
          handleBarcodeScan(val);
        }
      });
    }

    if (addForm) {
      addForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const nameEl = document.getElementById('itemName');
        const qtyEl = document.getElementById('itemQty');
        if (!nameEl || !qtyEl) return;
        addItem(nameEl.value, parseInt(qtyEl.value, 10), null);
        nameEl.value = '';
        qtyEl.value = '1';
        nameEl.focus();
      });
    }

    if (searchInput) searchInput.addEventListener('input', renderItems);
    if (clearBtn) clearBtn.addEventListener('click', clearAll);
    if (exportBtn) exportBtn.addEventListener('click', exportToExcel);
    if (camToggleBtn) camToggleBtn.addEventListener('click', toggleCamera);

    if (registerConfirmBtn) {
      registerConfirmBtn.addEventListener('click', () => {
        const name = document.getElementById('registerNameInput')?.value.trim();
        if (!name || !pendingBarcode) {
          showToast('Digite um nome para o produto.');
          return;
        }
        addProduct(pendingBarcode, name, { silent: true });
        addItem(name, 1, pendingBarcode);
        hideRegisterBox();
        if (barcodeInput) barcodeInput.focus();
      });
    }

    if (registerNameInput) {
      registerNameInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          registerConfirmBtn?.click();
        }
      });
    }

    if (registerCancelBtn) {
      registerCancelBtn.addEventListener('click', () => {
        hideRegisterBox();
        if (barcodeInput) barcodeInput.focus();
      });
    }

    if (barcodeInput) barcodeInput.focus();
  }

  // Eventos do formulario e da busca na tela de produtos.
  function bindProductsPage() {
    const productForm = document.getElementById('productForm');
    const searchInput = document.getElementById('prodSearchInput');
    if (productForm) {
      productForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const codeEl = document.getElementById('prodBarcode');
        const nameEl = document.getElementById('prodName');
        if (!codeEl || !nameEl) return;
        addProduct(codeEl.value, nameEl.value);
        codeEl.value = '';
        nameEl.value = '';
        codeEl.focus();
      });
    }

    if (searchInput) searchInput.addEventListener('input', renderProducts);
  }

  // Carregamento inicial e associacao da logica a pagina atual.
  function init() {
    loadAll();
    renderItems();
    renderProducts();

    const page = document.body.dataset.page;
    if (page === 'contagem') bindCountPage();
    if (page === 'produtos') bindProductsPage();
  }

  init();
})();