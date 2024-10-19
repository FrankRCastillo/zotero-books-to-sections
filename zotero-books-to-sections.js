function _create(doc, name) {
  const elem = Zotero.platformMajorVersion >= 102
             ? doc.createXULElement(name)
             : doc.createElementNS("http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul", name);
  return elem;
}

function log(msg, err) {
  Zotero.debug("Books To Sections: " + msg);

  if (err) {
    log(`Message: ${err.message}`);
    
    err.stack.split('\n').forEach((line, idx) => {
      log(`Stack: ${idx + 1}: ${line}`);
    });
  }
}

BooksToSections = {
  id              : null,
  version         : null,
  rootURI         : null,
  pdfjsLib        : null,
  initialized     : false,
  addedElementIDs : [],

  init({ id, version, rootURI, pdfjsLib }) {
    if (this.initialized) return;
    this.id          = id;
    this.version     = version;
    this.rootURI     = rootURI;
    this.pdfjsLib    = pdfjsLib;
    this.initialized = true;
  },

  async createBookSection(title, parentItem, collectionId) {
    let bookSection = new Zotero.Item('bookSection');

    bookSection.setField('title'    , title);
    bookSection.setField('bookTitle', parentItem.getField('title'));

    let fieldIdx = Zotero.ItemFields.getItemTypeFields(bookSection.itemTypeID);
    let fields   = fieldIdx.map(idx => Zotero.ItemFields.getName(idx));

    for (let field of fields) {
      if (!['title', 'bookTitle'].includes(field)) {
        let value = parentItem.getField(field);

        bookSection.setField(field, value);
      }
    }
    
    await bookSection.saveTx();

    bookSection.addToCollection(collectionId);

    await bookSection.saveTx();

    return bookSection;
  },

  async addAttachment(itemId, url) {
    let attachment = new Zotero.Item('attachment');
    
    attachment.setField('title'   , url);
    attachment.setField('url'     , url);
    attachment.parentID = itemId;
    attachment.attachmentLinkMode = Zotero.Attachments.LINK_MODE_LINKED_URL;

    await attachment.saveTx();
  },

  async getBookmarks(pdfDoc, outlineItems, store = [], maxdepth = 1) {
	  for (let item of outlineItems) {
		  if (!item.items || item.items.length === 0 || maxdepth == 1) {
			  if (typeof item.dest === 'object' && item.dest[0]?.num !== undefined) {
				  let page = await pdfDoc.getPageIndex(item.dest[0]) + 1;
				  
				  store.push({title: item.title, page});
				  continue;
			  }
			  
			  if (typeof item.dest === 'string') {
				  let [ref, fitType, ...args] = await pdfDoc.getDestination(item.dest); 
				  let page = await pdfDoc.getPageIndex(ref) + 1;
				  
				  store.push({title: item.title, page});
				  continue;
			  }
		  } else {
			  await BooksToSections.getBookmarks(pdfDoc, item.items, store, maxdepth - 1);
		  }
	  }
  },

  addToWindow(window) {
    let doc = window.document;

    // Check if menu already exists
    if (doc.getElementById("separate-chapters-menuitem")) {
      return;
    }    

    // Get Zotero's item context menu
    let menu = doc.getElementById('zotero-itemmenu');

    // Create new menu item
    let menuitem = _create(doc, "menuitem");

    // Set menu item attributes
    menuitem.setAttribute('id'   , 'separate-chapters-menuitem');
    menuitem.setAttribute('label', 'Book to Book Sections');

    // Run when clicked
    menuitem.addEventListener('command', async function() {
      let zpane    = Zotero.getActiveZoteroPane();
      let items    = zpane.getSelectedItems();
      let selCol   = zpane.getSelectedCollection();
      let progress = new Zotero.ProgressWindow({ closeOnClick: true, modal: true });;

      progress.changeHeadline('Books to Book Sections');
      progress.show();
      
      let progressItem = new progress.ItemProgress();
      progressItem.setProgress(0);
      progressItem.setText(`Processing item...`);

      try {
        for (let item of items) {
          let bookItemId  = item.id;
          let attachments = item.getAttachments();

          for (attachItemId of attachments) {
            log(`Starting Item: ${attachItemId}`);

            let attachment = await Zotero.Items.getAsync(attachItemId);
            let attachType = attachment.attachmentContentType;
            let libraryId  = Zotero.API.getLibraryPrefix(attachment.libraryID);

            if (attachType === 'application/pdf') {
              let pdfPath = attachment.getFilePath();
              let pdfData = await Zotero.File.getBinaryContentsAsync(pdfPath);
              let pdfDoc  = await pdfjsLib.getDocument({data : pdfData}).promise; 
              let outline = await pdfDoc.getOutline();

              if (!outline) {
                  window.alert(`No outline found. Quitting.`);
                  return;
              }

              progressItem.setText(`Processing item ${item.getField('title')}...`);

              let bookmarks = [];

              let maxdepth = window.prompt('Enter the maximum depth to look into the PDF bookmark.');

              if (!maxdepth || !Number.isInteger(maxdepth)) {
                window.alert('Invalid depth value. Enter a positive integer.');
                break;
              }

              maxdepth = parseInt(maxdepth);

              await BooksToSections.getBookmarks(pdfDoc, outline, bookmarks, maxdepth);

              let progressIndex = 0;
              let progressCount = bookmarks.length;

              for (const bookmark of bookmarks) {
                let { title, page } = bookmark;
                let webLinkURL = `zotero://open-pdf/${libraryId}/items/${attachment.key}?page=${page}`;
                let newSection = await BooksToSections.createBookSection(title, item, selCol.id);

                await BooksToSections.addAttachment(newSection.id, webLinkURL);

                progressIndex = progressIndex + 1;

                let progressPct = Math.floor((progressIndex / progressCount) * 100);

                progressItem.setText(`Finished ${progressIndex} of ${progressCount}`);
                progressItem.setProgress(progressPct); 

              }

              progressItem.setText(`Finished ${item.getField('title')}`);
              progressItem.setProgress(100);

            } else {
              log(`Not a valid PDF file. Skipping ${attachItemId}`);

            }
          }
        }
      } catch (e) {
        log('Error processing items', e);
        progressItem.setError();

      } finally {
        log('Ending process');
        progress.close();

      }
    });

    log('Adding element to item menu');
    menu.appendChild(menuitem);
    this.storeAddedElement(menuitem);
  },

  removeFromWindow(window) {
    let doc = window.document;

    // Remove all elements with the stored IDs
    this.addedElementIDs.forEach(id => {
      let elem = doc.getElementById(id);
      if (elem) {
        elem.remove();
      }
    });

    // Clear the added elements' IDs after removal
    this.addedElementIDs = [];
  },

  addToAllWindows() {
    var windows = Zotero.getMainWindows();

    for (let win of windows) {
      if (win.ZoteroPane) {
        this.addToWindow(win);
      }
    }
  },

  removeFromAllWindows() {
    let windows = Zotero.getMainWindows();

    for (let win of windows) {
      if (win.ZoteroPane) {
        this.removeFromWindow(win);
      }
    }
  },

  storeAddedElement(elem) {
    if (!elem.id) {
      throw new Error("Element must have an id");
    }

    this.addedElementIDs.push(elem.id);
  },
};
