function _create(doc, name)
{
  const elem = Zotero.platformMajorVersion >= 102
             ? doc.createXULElement(name)
             : doc.createElementNS("http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul", name);
  return elem;
}

function log(msg, err)
{
  Zotero.debug("Books To Sections: " + msg);

  if (err)
  {
    let errmsg = `Error: ${err.message}`;

    log(errmsg);

    window.alert(`${errmsg}\nSee Debug Output (Help > Debug Output Logging > View Output) for more information.`);
    
    err.stack.trim().split('\n').forEach((line, idx) => 
    {
      log(`Stack: ${idx + 1}: ${line}`);
    });
  }
}

function FilePathToURL(path)
{
  return Zotero.isWin ? 'file:///' + path.replace(/\\/g, '/').replace(/ /g, '%20')
                      : 'file://' + path.replace(/ /g, '%20');
}

async function writeFile(path, content)
{
  log(`Writing to file ${path}`);
}

async function parseOutlineFile(path, bookmarks)
{
  let text = await Zotero.File.getContentsAsync(path);
  let rows = text.replace('\r', '').split('\n');

  for (let row of rows)
  {
    if (!row.trim()) continue;

    let rowMatch = row.match(/^"?(.*?)"?\s*,\s*(\d+)$/);

    if (!rowMatch) continue;

    let title = rowMatch[1];
    let page  = parseInt(rowMatch[2]);

    if (title[0] == '#') continue;

    let elem = { title, page }

    bookmarks.push(elem);
  }
}

async function getBookmarksFromOutline(pdfDocument, outlineItems, store = [], maxDepth = 1)
{
  for (let item of outlineItems)
  {
    if (!item.items || item.items.length === 0 || maxDepth == 1)
    {
      if (typeof item.dest === 'object' && item.dest[0]?.num !== undefined)
      {
        let page = await pdfDocument.getPageIndex(item.dest[0]) + 1;
        
        store.push({title: item.title, page});
        continue;
      }
      
      if (typeof item.dest === 'string')
      {
        let [ref, fitType, ...args] = await pdfDocument.getDestination(item.dest); 
        let page = await pdfDocument.getPageIndex(ref) + 1;
        let elem = {title: item.title, page};

        store.push(elem);
        continue;
      }
    }
    else
    {
      await getBookmarksFromOutline(pdfDocument, item.items, store, maxDepth - 1);
    }
  }
}

async function createBookSection(title, parentItem, collectionId)
{
  let bookSection = new Zotero.Item('bookSection');

  bookSection.setField('title'    , title);
  bookSection.setField('bookTitle', parentItem.getField('title'));

  let fieldIdx = Zotero.ItemFields.getItemTypeFields(bookSection.itemTypeID);
  let fields   = fieldIdx.map(idx => Zotero.ItemFields.getName(idx));

  for (let field of fields)
  {
    if (!['title', 'bookTitle'].includes(field))
    {
      let value = parentItem.getField(field);

      bookSection.setField(field, value);
    }
  }
  
  await bookSection.saveTx();

  bookSection.addToCollection(collectionId);

  await bookSection.saveTx();

  return bookSection;
}

async function addAttachment(parentItemID, title, path)
{
  log(`Attaching file ${path}`);

  let attachment; 
  
  if (/^(https?|ftp|zotero):\/\//i.test(path))
  {
    attachment = new Zotero.Item('attachment');
    attachment.setField('title', title);
    attachment.setField('url', path);
    attachment.parentID = parentItemID;
    attachment.attachmentLinkMode = Zotero.Attachments.LINK_MODE_LINKED_URL;
    await attachment.saveTx();
    return;
  }

  let file = Zotero.File.pathToFile(path);

  if (!file || !file.exists())
  {
    log(`File ${path} does not exist. Quitting.`);
    return;
  }

  log(`File exists: ${path}`);

  let attachArgs = { file, parentItemID, title };

  attachment = await Zotero.Attachments.linkFromFile(attachArgs);

  if (!attachment)
  {
    log(`Failed to create file ${path}`);
    return;
  }
  
  await attachment.saveTx();
}

async function getAttachment(item, title)
{
  let attachments = item.getAttachments();

  for (let attachmentId of attachments)
  {
    let attachment = await Zotero.Items.getAsync(attachmentId);

    if (attachment.getField('title') === title)
    {
      return attachment;
    }
  }

  return null;
}

BooksToSections = {
  id              : null,
  version         : null,
  rootURI         : null,
  pdfjsLib        : null,
  initialized     : false,
  addedElementIDs : [],

  init({ id, version, rootURI, pdfjsLib })
  {
    if (this.initialized) return;
    this.id          = id;
    this.version     = version;
    this.rootURI     = rootURI;
    this.pdfjsLib    = pdfjsLib;
    this.initialized = true;
  },

  addToWindow(window)
  {
    let doc = window.document;

    // check if menu already exists
    if (doc.getElementById("separate-chapters-menuitem")) return;    

    // get zotero's item context menu
    let menu = doc.getElementById('zotero-itemmenu');

    // create new menu item
    let menuItem = _create(doc, "menuitem");

    // set menu item attributes
    menuItem.setAttribute('id'   , 'separate-chapters-menuitem');
    menuItem.setAttribute('label', 'Books to Book Sections');

    // run when clicked
    menuItem.addEventListener('command', async function()
    {
      let zpane = Zotero.getActiveZoteroPane();
      let selectedItems      = zpane.getSelectedItems();
      let selectedCollection = zpane.getSelectedCollection();
      let outlineFileName    = 'outline-b2bs.txt'

      try
      {
        for (let item of selectedItems)
        {
          let bookItemId  = item.id;
          let itemTitle   = item.getField('title');
          let attachments = item.getAttachments();

          for (attachItemId of attachments)
          {
            log(`Starting item: ${attachItemId}`);

            let attachment = await Zotero.Items.getAsync(attachItemId);
            let attachType = attachment.attachmentContentType;

            // if attachment is not a PDF, skip to next
            if (attachType !== 'application/pdf')
            {
              log(`Not a valid PDF file. skipping ${attachItemId}`);
              continue;
            }

            // process PDF attachment
            let attachPath  = attachment.getFilePath();
            let attachDir   = Zotero.File.pathToFile(attachPath).parent.path;
            let pdfBinary   = await Zotero.File.getBinaryContentsAsync(attachPath);
            let pdfDocument = await pdfjsLib.getDocument({data : pdfBinary}).promise; 
            let pdfOutline  = await pdfDocument.getOutline();
            let outlinePath = Zotero.File.pathToFile(attachDir);

            // load outline file
            outlinePath.append(outlineFileName);

            outlinePath = outlinePath.path;
            
            if (Zotero.isWin) outlinePath = outlinePath.replace(/\\/g,"\\\\");

            let txtOutline = await getAttachment(item, outlineFileName);
            let bookmarks  = [];

            // check if outline note exists in item
            if (txtOutline)
            {
              log(`outline-b2bs.txt file found. Creating bookmarks from file ${outlinePath}.`);

              await parseOutlineFile(outlinePath, bookmarks);

              if (bookmarks.length === 0)
              {
                  window.alert('The outline file for this item is empty. Please revise and try again. Skipping.');
                  continue;
              }
            }

            // check if outline exists
            if (pdfOutline && !txtOutline)
            {
              let maxDepth = window.prompt('Enter the maximum depth to look into the PDF bookmark.');

              maxDepth = parseInt(maxDepth);

              log(`Max depth value: ${maxDepth}`);

              // End if maximum depth is neither an integer or is less than/equal to zero
              if (!Number.isInteger(maxDepth) || maxDepth <= 0)
              {
                window.alert('Invalid depth value. Enter a positive integer. Skipping to next file, if any.');
                continue;
              }

              await getBookmarksFromOutline(pdfDocument, pdfOutline, bookmarks, maxDepth);
            }

            if (!pdfOutline && !txtOutline)
            {
              let createOutlineMsg = 'No outline found.\n'
                                   + 'Press OK to create an attachment and add your outline there.\n'
                                   + 'Press Cancel to abort.'
              let createOutlineBln = window.confirm(createOutlineMsg);

              // End if user presses cancel
              if (!createOutlineBln) break;

              let outlineContent = '# title (use quotes if there are spaces), page number\n'
                                 + '# "Chapter 1", 1\n'
                                 + '# "Chapter 2", 2\n'
                                 + '# ...\n';

              await Zotero.File.putContentsAsync(outlinePath, outlineContent);

              await addAttachment(item.id, outlineFileName, outlinePath);

              window.alert( `A file called \'${outlineFileName}\' has been added to this item.\n`
                          + 'Edit this file to add your desired outline; the file will have examples.\n'
                          + 'Lines starting with # will be ignored.'
                          );
              break;
            }

            let progressIndex = 0;
            let progressCount = bookmarks.length;
            let libraryId  = Zotero.API.getLibraryPrefix(attachment.libraryID);

            Zotero.showZoteroPaneProgressMeter(null, true);

            for (const bookmark of bookmarks)
            {
              progressIndex = progressIndex + 1;

              let progressPct = Math.floor((progressIndex / progressCount) * 100);

              Zotero.updateZoteroPaneProgressMeter(progressPct);

              let { title, page } = bookmark;
              let webLinkURL = `zotero://open-pdf/${libraryId}/items/${attachment.key}?page=${page}`;
              let newSection = await createBookSection(title, item, selectedCollection.id);

              await addAttachment(newSection.id, webLinkURL, webLinkURL);
            }
          }
        }
      }
      catch (e)
      {
        log('Error processing items', e);
        // progressItem.setError();
      }
      finally
      {
        log('Ending');
        // progress.startCloseTimer(1000);
        Zotero.hideZoteroPaneOverlays();
      }
    });

    log('Adding to item menu');
    menu.appendChild(menuItem);
    this.storeAddedElement(menuItem);
  },

  removeFromWindow(window)
  {
    let doc = window.document;

    this.addedElementIDs.forEach(id =>
    {
      let elem = doc.getElementById(id);
      if (elem) elem.remove();
    });

    this.addedElementIDs = [];
  },

  addToAllWindows()
  {
    var windows = Zotero.getMainWindows();

    for (let win of windows)
    {
      if (win.ZoteroPane) this.addToWindow(win);
    }
  },

  removeFromAllWindows()
  {
    let windows = Zotero.getMainWindows();

    for (let win of windows)
    {
      if (win.ZoteroPane) this.removeFromWindow(win);
    }
  },

  storeAddedElement(elem)
  {
    if (!elem.id) throw new Error("Element must have an id");

    this.addedElementIDs.push(elem.id);
  },
};
