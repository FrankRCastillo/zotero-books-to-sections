var BooksToSections;

function log(msg, err) {
  Zotero.debug("Books To Sections: " + msg);

  if (err) {
    log(`Message: ${err.message}`);
    
    err.stack.split('\n').forEach((line, idx) => {
      log(`Stack: ${idx + 1}: ${line}`);
    });
  }
}

function install() {
  log("Installed");
}

async function startup({ id, version, rootURI }) {
  log("Starting");
  
  log(`URI: ${rootURI}`);

  // Define a global console object
  if (typeof console === 'undefined') {
    console = { log   : function(msg) { log(msg); }
              , warn  : function(msg) { log('Warning: ' + msg); }
              , error : function(msg) { log('Error: ' + msg); }
              };
  }

  if (typeof navigator === 'undefined') {
    this.navigator = { userAgent : 'Zotero/5.0'
                     , platform  : 'Zotero'
                     , language  : 'en-US'
                     };
  }

  // Load application Javascript file
  Services.scriptloader.loadSubScript(`${rootURI}zotero-books-to-sections.js`);

  Services.scriptloader.loadSubScript('resource://pdf.js/build/pdf.js', this);

  let pdfjsLib = this.pdfjsLib;

  pdfjsLib.GlobalWorkerOptions.workerSrc = 'resource://pdf.js/build/pdf.worker.js';

  // Initialize the plugin
  BooksToSections.init({ id, version, rootURI, pdfjsLib });

  // Add plugin to UI
  BooksToSections.addToAllWindows();
}

function onMainWindowLoad({ window }) {
  BooksToSections.addToWindow(window);
}

function onMainWindowUnload({ window }) {
  log("Shutting down Started");

  BooksToSections.removeFromWindow(window);

  log("Shutting down Complete");
}

function shutdown() {
  log("Shutting down Started");

  if (typeof BooksToSections !== 'undefined') {
    BooksToSections.removeFromAllWindows();
    BooksToSections = undefined;
  }

  log("Shutting down Complete");
}

function uninstall() {
  log("Uninstalling");

  if (typeof BooksToSections !== 'undefined') {
    // Remove preferences
    Zotero.PreferencePanes.unregister('zotero-books-to-sections@zbts.com');

    // Perform UI cleanup
    BooksToSections.removeFromAllWindows();

    // Try to remove plugin settings
    try {
      Zotero.Prefs.clearBranch('extensions.zotero-books-to-sections.');
      log("Cleared preferences");
    } catch (e) {
      log("Error clearing preferences: " + e);
    }

    BooksToSections = undefined;
  } else {
    log("BooksToSections is not defined during uninstall.");
  }

  log("Uninstalling Books");
}
