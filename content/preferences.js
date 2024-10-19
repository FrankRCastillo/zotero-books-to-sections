window.addEventListener('load', function () {
  const prefs = Zotero.Prefs;
  const optionOneCheckbox = document.getElementById('placeholder');

  optionOneCheckbox.checked = prefs.get('extensions.zotero-books-to-sections.placeholder', true);
  optionOneCheckbox.addEventListener('change', function (e) {
    prefs.set('extensions.zotero-books-to-sections.placeholder', e.target.checked);
  });
});
