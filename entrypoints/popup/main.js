document.addEventListener("DOMContentLoaded", () => {
  const toggle           = document.getElementById("commissionToggle");
  const copyBtnToggle    = document.getElementById("copyBtnToggle");
  const showTokenToggle  = document.getElementById("showTokenToggle");
  const copyBtnSizeSlider= document.getElementById("copyBtnSizeSlider");
  const copyBtnSizeValue = document.getElementById("copyBtnSizeValue");
  const posSelect        = document.getElementById("positionSelect");
  const opacitySlider    = document.getElementById("opacitySlider");
  const opacityValue     = document.getElementById("opacityValue");
  const styleSelect      = document.getElementById("styleSelect");
  const fontSizeSlider   = document.getElementById("fontSizeSlider");
  const fontSizeValue    = document.getElementById("fontSizeValue");
  const resetBtn         = document.getElementById("resetBtn");

  const defaults = {
    commission: true, copyBtn: false, copyBtnSize: 18, position: "bottom-right",
    opacity: 75, badgeStyle: "background", fontSize: 16,
    effectRed: "price-effect-rgb", effectPurple: "price-effect-tilt",
    effectYellow: "price-effect-bg", effectGreen: "price-effect-pulse", effectWhite: "",
    showToken: false
  };

  // FIX: дебаунс для слайдеров — предотвращает 20-50 полных перерисовок
  // при быстром движении ползунка (каждый storage.set → полный ре-рендер всех карт)
  function debounce(fn, ms) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  }

  // Загружаем состояние при открытии popup
  chrome.storage.local.get(defaults, (result) => {
    if (toggle)            toggle.checked           = result.commission;
    if (copyBtnToggle)     copyBtnToggle.checked     = result.copyBtn;
    if (showTokenToggle)   showTokenToggle.checked   = result.showToken;
    if (copyBtnSizeSlider && copyBtnSizeValue) {
      copyBtnSizeSlider.value      = result.copyBtnSize;
      copyBtnSizeValue.textContent = result.copyBtnSize + "px";
    }
    if (posSelect)         posSelect.value           = result.position;
    if (opacitySlider && opacityValue) {
      opacitySlider.value      = result.opacity;
      opacityValue.textContent = result.opacity + "%";
    }
    if (styleSelect)       styleSelect.value         = result.badgeStyle;
    if (fontSizeSlider && fontSizeValue) {
      fontSizeSlider.value      = result.fontSize;
      fontSizeValue.textContent = result.fontSize + "px";
    }
    ["Red","Purple","Yellow","Green","White"].forEach(color => {
      const el = document.getElementById("effect" + color);
      if (el) el.value = result["effect" + color];
    });
  });

  // Чекбоксы — мгновенно (не требуют дебаунса)
  if (toggle) {
    toggle.addEventListener("change", (e) => {
      chrome.storage.local.set({ commission: e.target.checked });
    });
  }
  if (copyBtnToggle) {
    copyBtnToggle.addEventListener("change", (e) => {
      chrome.storage.local.set({ copyBtn: e.target.checked });
    });
  }
  if (showTokenToggle) {
    showTokenToggle.addEventListener("change", (e) => {
      if (e.target.checked) {
        const confirmToken = confirm("ВНИМАНИЕ!\nТокен дает полный доступ к вашему аккаунту Senkuro. \nНикогда не передавайте его третьим лицам! \nВы уверены, что хотите отобразить токен?");
        if (!confirmToken) {
          e.target.checked = false;
          return;
        }
      }
      chrome.storage.local.set({ showToken: e.target.checked });
    });
  }

  // Слайдеры — с дебаунсом 150мс
  if (copyBtnSizeSlider) {
    const save = debounce((v) => chrome.storage.local.set({ copyBtnSize: v }), 150);
    copyBtnSizeSlider.addEventListener("input", (e) => {
      if (copyBtnSizeValue) copyBtnSizeValue.textContent = e.target.value + "px";
      save(parseInt(e.target.value, 10));
    });
  }

  if (opacitySlider) {
    const save = debounce((v) => chrome.storage.local.set({ opacity: v }), 150);
    opacitySlider.addEventListener("input", (e) => {
      if (opacityValue) opacityValue.textContent = e.target.value + "%";
      save(parseInt(e.target.value, 10));
    });
  }

  if (fontSizeSlider) {
    const save = debounce((v) => chrome.storage.local.set({ fontSize: v }), 150);
    fontSizeSlider.addEventListener("input", (e) => {
      if (fontSizeValue) fontSizeValue.textContent = e.target.value + "px";
      save(parseInt(e.target.value, 10));
    });
  }

  // Селекты — мгновенно
  if (posSelect) {
    posSelect.addEventListener("change", (e) => {
      chrome.storage.local.set({ position: e.target.value });
    });
  }
  if (styleSelect) {
    styleSelect.addEventListener("change", (e) => {
      chrome.storage.local.set({ badgeStyle: e.target.value });
    });
  }

  // Эффекты — мгновенно
  ["Red","Purple","Yellow","Green","White"].forEach(color => {
    const el = document.getElementById("effect" + color);
    if (el) {
      el.addEventListener("change", (e) => {
        chrome.storage.local.set({ ["effect" + color]: e.target.value });
      });
    }
  });

  // Сброс настроек
  if (resetBtn) {
    resetBtn.addEventListener("click", () => {
      chrome.storage.local.set(defaults, () => {
        if (toggle)        toggle.checked              = defaults.commission;
        if (copyBtnToggle) copyBtnToggle.checked        = defaults.copyBtn;
        if (showTokenToggle) showTokenToggle.checked    = defaults.showToken;
        if (copyBtnSizeSlider && copyBtnSizeValue) {
          copyBtnSizeSlider.value      = defaults.copyBtnSize;
          copyBtnSizeValue.textContent = defaults.copyBtnSize + "px";
        }
        if (posSelect)     posSelect.value              = defaults.position;
        if (opacitySlider && opacityValue) {
          opacitySlider.value      = defaults.opacity;
          opacityValue.textContent = defaults.opacity + "%";
        }
        if (styleSelect)   styleSelect.value            = defaults.badgeStyle;
        if (fontSizeSlider && fontSizeValue) {
          fontSizeSlider.value      = defaults.fontSize;
          fontSizeValue.textContent = defaults.fontSize + "px";
        }
        ["Red","Purple","Yellow","Green","White"].forEach(color => {
          const el = document.getElementById("effect" + color);
          if (el) el.value = defaults["effect" + color];
        });
      });
    });
  }
});
