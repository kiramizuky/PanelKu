/**
 * Panelku — themes.js
 * Theme Manager — select, customize, upload themes
 */

const ThemesPage = {
  currentTheme: localStorage.getItem('lp_theme') || 'dark',

  async init() {
    await LP.init();
    this.loadThemeOptions();
    this.loadCustomCSS();
  },

  loadThemeOptions() {
    const current = this.currentTheme;
    document.querySelectorAll('.theme-option').forEach(el => {
      const theme = el.dataset.theme;
      el.style.border = theme === current ? '2px solid var(--accent-primary)' : '2px solid transparent';
      if (theme === current) {
        document.getElementById('currentThemeBadge').textContent = this._themeName(theme);
      }
    });
  },

  _themeName(theme) {
    const names = { dark: 'Dark', light: 'Light', midnight: 'Midnight', dracula: 'Dracula' };
    return names[theme] || theme;
  },

  selectBuiltin(theme) {
    if (theme === this.currentTheme) return;

    localStorage.setItem('lp_theme', theme);
    this.currentTheme = theme;
    this.loadThemeOptions();

    // Apply theme by toggling body class
    document.documentElement.setAttribute('data-theme', theme);

    // Set theme attributes directly (don't call LP.toggleTheme which only toggles dark↔light)
    const isLight = theme === 'light';
    document.documentElement.style.colorScheme = isLight ? 'light' : 'dark';
    document.documentElement.setAttribute('data-bs-theme', isLight ? 'light' : 'dark');
    document.documentElement.setAttribute('data-theme', theme);

    LP.toast(`Theme changed to ${this._themeName(theme)}`, 'success');

    // Save custom CSS for this theme
    this.applyCustomCSS();
  },

  // ── Custom CSS ───────────────────────────────────────────────────

  loadCustomCSS() {
    const saved = localStorage.getItem('lp_custom_css_' + this.currentTheme) || '';
    document.getElementById('customCSS').value = saved;
    this.applyCustomCSS();
  },

  saveCustomCSS() {
    const css = document.getElementById('customCSS').value;
    localStorage.setItem('lp_custom_css_' + this.currentTheme, css);
    this.applyCustomCSS();
    LP.toast('Custom CSS applied!', 'success');
  },

  applyCustomCSS() {
    const theme = this.currentTheme;
    const css = localStorage.getItem('lp_custom_css_' + theme) || '';

    // Remove existing custom style
    const existing = document.getElementById('lp-custom-theme-style');
    if (existing) existing.remove();

    if (css.trim()) {
      const style = document.createElement('style');
      style.id = 'lp-custom-theme-style';
      style.textContent = css;
      document.head.appendChild(style);
    }
  },

  // ── Upload Theme ─────────────────────────────────────────────────

  uploadTheme(input) {
    const file = input.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const content = e.target.result;

        // Handle CSS files
        if (file.name.endsWith('.css')) {
          const _themeName = file.name.replace('.css', '');
          localStorage.setItem('lp_custom_css_' + this.currentTheme, content);
          this.applyCustomCSS();
          LP.toast(`Theme CSS "${file.name}" loaded!`, 'success');
          document.getElementById('customCSS').value = content;
          return;
        }

        // Handle JSON theme files
        const theme = JSON.parse(content);
        if (!theme.name || !theme.colors) {
          LP.toast('Invalid theme JSON: must have "name" and "colors" properties', 'error');
          return;
        }

        // Store theme in localStorage
        const themes = JSON.parse(localStorage.getItem('lp_custom_themes') || '[]');
        themes.push({
          id: Date.now().toString(),
          name: theme.name,
          author: theme.author || 'Unknown',
          colors: theme.colors,
          css: theme.css || '',
        });
        localStorage.setItem('lp_custom_themes', JSON.stringify(themes));

        LP.toast(`Theme "${theme.name}" uploaded!`, 'success');
      } catch (err) {
        LP.toast('Failed to parse theme file: ' + err.message, 'error');
      }
    };
    reader.readAsText(file);

    // Reset input
    input.value = '';
  },
};

document.addEventListener('DOMContentLoaded', () => ThemesPage.init());
