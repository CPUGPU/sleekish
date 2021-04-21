const { app, BrowserWindow, nativeTheme, electron, ipcMain, Notification, dialog, clipboard } = require("electron");
const fs = require("fs");
const path = require("path");
const i18next = require("i18next");
const i18nextBackend = require("i18next-fs-backend");
const i18nextOptions = require('./configs/i18next.config');
const Store = require("./configs/store.config.js");
const userData = new Store({
  configName: "user-preferences",
  defaults: {
    window: { x: 164, y: 210, width: 1024, height: 768 },
    maximizeWindow: false,
    showCompleted: true,
    sortCompletedLast: true,
    showHidden: true,
    showDueIsToday: true,
    showDueIsFuture: true,
    showDueIsPast: true,
    selectedFilters: new Array,
    categoriesFiltered: new Array,
    dismissedNotifications: new Array,
    dismissedMessages: new Array,
    theme: null,
    matomoEvents: false,
    notifications: true,
    language: null,
    files: new Array,
    uid: null,
    drawerWidth: "560",
    useTextarea: false,
    filterDrawer: false,
    compactView: false,
    sortBy: "priority",
    zoom: 100
  }
});
if(process.env.NODE_ENV==="development") {
  var isDevelopment = true;
} else {
  var isDevelopment = false;
}
const appData = {
  version: app.getVersion(),
  development: isDevelopment,
  languages: i18nextOptions.supportedLngs,
  path: __dirname,
  os: null
}
const createWindow = () => {
  // ########################################################################################################################
  // FUNCTIONS
  // ########################################################################################################################
  function openDialog(args) {
    // if a file is already active, it's directory will be chosen as default path
    if(userData.data.path) {
      var defaultPath = userData.data.path;
    } else {
      var defaultPath = path.join(app.getPath('home'))
    }
    let file;
    switch (args) {
      case "open":
        dialog.showOpenDialog({
          title: i18next.t("selectFile"),
          defaultPath: defaultPath,
          buttonLabel: i18next.t("windowButtonOpenFile"),
          filters: [{
            name: i18next.t("windowFileformat"),
            extensions: ["txt", "md"]
          }],
          properties: ["openFile"]
        }).then(file => {
          if (!file.canceled) {
            file = file.filePaths[0].toString();
            // persist the path
            userData.data.path = path.dirname(file);
            userData.set("path", userData.data.path);
            console.log("Success: Opened file: " + file);
            startFileWatcher(file).then(response => {
              console.log(response);
              mainWindow.webContents.send("triggerFunction", "resetModal")
            }).catch(error => {
              console.log(error);
            });
          }
        }).catch(error => {
            console.log("Error: " + error)
        });
        break;
      case "create":
        dialog.showSaveDialog({
          title: i18next.t("windowTitleCreateFile"),
          defaultPath: defaultPath + "/todo.txt",
          buttonLabel: i18next.t("windowButtonCreateFile"),
          filters: [{
            name: i18next.t("windowFileformat"),
            extensions: ["txt", "md"]
          }],
          properties: ["openFile", "createDirectory"]
        }).then(file => {
          // close filewatcher, otherwise the change of file will trigger a duplicate refresh
          if(fileWatcher) fileWatcher.close();
          fs.writeFile(file.filePath, "", function (error) {
            if (!file.canceled) {
              userData.data.path = path.dirname(file.filePath);
              userData.set("path", userData.data.path);
              console.log("Success: New file created: " + file.filePath);
              startFileWatcher(file.filePath).then(response => {
                console.log(response);
                mainWindow.webContents.send("triggerFunction", "resetModal")
              }).catch(error => {
                console.log(error);
              });
            }
          });
        }).catch(error => {
          console.log("Error: " + error)
        });
        break;
    }
  }
  function setLanguage(language) {
    try {
      i18next
      .use(i18nextBackend)
      .init(i18nextOptions);
      if(!language && !userData.get("language") && i18nextOptions.supportedLngs.includes(app.getLocale().substr(0,2))) {
        var language = app.getLocale().substr(0,2);
      } else if(!language && userData.get("language")) {
        var language = userData.get("language");
      } else if(!language) {
        var language = "en";
      }
      userData.set("language", language);
      i18next.changeLanguage(language, (error) => {
        if (error) return console.log("Error in setLanguage():", error);
        userData.set("language", language);
      });
      return Promise.resolve("Success: Language set to: " + language);
    } catch (error) {
      // trigger matomo event
      if(userData.matomoEvents) _paq.push(["trackEvent", "Error", "setLanguage()", error])
      return Promise.reject("Error in setLanguage(): " + error);
    }
  }
  function fileContent(file) {
    try {
      if(!fs.existsSync(file)) {
        return Promise.resolve(fs.writeFile(file, "", function (error) {
          if(error) return Promise.reject("Error: Could not create file");
          return "";
        }));
      }
      return Promise.resolve(fs.readFileSync(file, {encoding: 'utf-8'}, function(err,data) { return data; }));
    } catch (error) {
      // trigger matomo event
      if(userData.data.matomoEvents) _paq.push(["trackEvent", "Error", "fileContent()", error])
      return Promise.reject("Error in fileContent(): " + error);
    }
  }
  function startFileWatcher(newFile) {
    try {
      // use the loop to check if the new path is already in the user data
      let fileFound = false;
      if(userData.data.files) {
        userData.data.files.forEach(function(file) {
          // if path is found it is set active
          if(file[1]===newFile) {
            file[0] = 1
            fileFound = true;
          // if this entry is not equal to the new path it is set 0
          } else {
            file[0] = 0;
          }
        });
      } else {
        userData.data.files = new Array;
      }
      // only push new path if it is not already in the user data
      if((!fileFound || !userData.data.files) && newFile) userData.data.files.push([1, newFile]);
      userData.set("files", userData.data.files);
      userData.data.file = newFile;
      userData.set("file", newFile);
      mainWindow.webContents.send("userData", userData.data);
      if (fs.existsSync(newFile)) {
        if(fileWatcher) fileWatcher.close();
        fileWatcher = fs.watch(newFile, (event, filename) => {
          console.log("Info: File " + filename + " has changed");
          setTimeout(function() {
            fileContent(newFile).then(content => {
              mainWindow.webContents.send("refresh", content)
            }).catch(error => {
              console.log(error);
            });
          }, 10);
        });
      }
      fileContent(newFile).then(content => {
        mainWindow.webContents.send("refresh", content);
      }).catch(error => {
        console.log(error);
      });
      // return promise
      return Promise.resolve("Success: Filewatcher is watching: " + newFile);
    } catch (error) {
      // trigger matomo event
      if(userData.data.matomoEvents) _paq.push(["trackEvent", "Error", "startFileWatcher()", error])
      return Promise.reject("Error in startFileWatcher(): " + error);
    }
  }
  let fileWatcher;
  // ########################################################################################################################
  // SET DEFAULT USERDATA
  // ########################################################################################################################
  if(!userData.data.theme && nativeTheme.shouldUseDarkColors) {
    userData.set("theme", "dark");
  } else if(!userData.data.theme && !nativeTheme.shouldUseDarkColors) {
    userData.set("theme", "light");
  }
  if(typeof userData.data.window != "object") userData.set("window", { x: 160, y: 240, width: 1024, height: 768 });
  if(typeof userData.data.maximizeWindow != "boolean") userData.set("maximizeWindow", false);
  if(typeof userData.data.notifcations != "boolean") userData.set("notifications", true);
  if(typeof userData.data.useTextarea != "boolean") userData.set("useTextarea", false);
  if(typeof userData.data.compactView != "boolean") userData.set("compactView", false);
  if(typeof userData.data.matomoEvents != "boolean") userData.set("matomoEvents", false);
  if(typeof userData.data.drawerWidth != "string") userData.set("drawerWidth", "500");
  if(typeof userData.data.showDueIsPast != "boolean") userData.set("showDueIsPast", true);
  if(typeof userData.data.showDueIsFuture != "boolean") userData.set("showDueIsFuture", true);
  if(typeof userData.data.showDueIsToday != "boolean") userData.set("showDueIsToday", true);
  if(typeof userData.data.showHidden != "boolean") userData.set("showHidden", true);
  if(typeof userData.data.showCompleted != "boolean") userData.set("showCompleted", true);
  if(typeof userData.data.sortCompletedLast != "boolean") userData.set("sortCompletedLast", true);
  if(typeof userData.data.sortBy != "string") userData.set("sortBy", "priority");
  if(typeof userData.data.zoom != "string") userData.set("zoom", "100");
  if(!Array.isArray(userData.data.dismissedNotifications)) userData.set("dismissedNotifications", []);
  if(!Array.isArray(userData.data.dismissedMessages)) userData.set("dismissedMessages", []);
  if(!Array.isArray(userData.data.hideFilterCategories)) userData.set("hideFilterCategories", []);
  // ########################################################################################################################
  // CREATE WINDOW
  // ########################################################################################################################
  //const { x, y, width, height } = userData.get("window");
  const mainWindow = new BrowserWindow({
    width: userData.data.width,
    height: userData.data.height,
    icon: path.join(__dirname, "../assets/icons/sleek.png"),
    simpleFullscreen: true,
    autoHideMenuBar: true,
    webPreferences: {
      enableRemoteModule: false,
      worldSafeExecuteJavaScript:true,
      nodeIntegration: false,
      enableRemoteModule: true,
      spellcheck: false,
      contextIsolation: true,
      preload: path.join(__dirname, "preload.js"),
    }
  });

  // ########################################################################################################################
  // TRIGGER
  // ########################################################################################################################
  setLanguage().then(response => {
    console.log(response);
  }).catch(error => {
    console.log(error);
  });
  // ########################################################################################################################
  // MENU CONFIGURATION (https://dev.to/abulhasanlakhani/conditionally-appending-developer-tools-menuitem-to-an-existing-menu-in-electron-236k)
  // ########################################################################################################################
  // Modules to create application menu
  const Menu = require("electron").Menu;
  const menuTemplate = [
    {
      label: i18next.t("file"),
      submenu: [
        {
          label: i18next.t("openFile"),
          accelerator: "CmdOrCtrl+o",
          click: function (item, focusedWindow) {
            openDialog("open");
          }
        },
        {
          label: i18next.t("createFile"),
          click: function (item, focusedWindow) {
            openDialog("create");
          }
        },
        appData.os==="mac" ? {
          role: "quit",
          label: i18next.t("close")
        } : {
          role: "close",
          label: i18next.t("close")
        }
      ]
    },
    {
      label: i18next.t("edit"),
      submenu: [
      {
        label: i18next.t("settings"),
        accelerator: "CmdOrCtrl+,",
        click: function () {
          mainWindow.webContents.executeJavaScript("showContent(modalSettings)");
        }
      },
      { type: "separator" },
      { label: i18next.t("cut"), accelerator: "CmdOrCtrl+X", selector: "cut:" },
      { label: i18next.t("copy"), accelerator: "CmdOrCtrl+C", selector: "copy:" },
      { label: i18next.t("paste"), accelerator: "CmdOrCtrl+V", selector: "paste:" }
    ]},
    {
      label: i18next.t("todos"),
      submenu: [
        {
          label: i18next.t("addTodo"),
          accelerator: "CmdOrCtrl+n",
          click: function (item, focusedWindow) {
            mainWindow.webContents.send("triggerFunction", "showForm")
          }
        },
        {
          label: i18next.t("find"),
          accelerator: "CmdOrCtrl+f",
          click: function (item, focusedWindow) {
            mainWindow.webContents.executeJavaScript("todoTableSearch.focus()");
          }
        },
        {
          label: i18next.t("archive"),
          click: function (item, focusedWindow) {
            mainWindow.webContents.send("triggerFunction", "archiveTodos")
          }
        }
      ]
    },
    {
      label: i18next.t("view"),
      submenu: [
        {
          label: i18next.t("toggleFilter"),
          accelerator: "CmdOrCtrl+b",
          click: function (item, focusedWindow) {
            mainWindow.webContents.send("triggerFunction", "showDrawer", ["toggle", "navBtnFilter", "filterDrawer"])
          }
        },
        {
          label: i18next.t("resetFilters"),
          accelerator: "CmdOrCtrl+l",
          click: function (item, focusedWindow) {
            mainWindow.webContents.send("triggerFunction", "resetFilters")
          }
        },
        {
          label: i18next.t("toggleCompletedTodos"),
          accelerator: "CmdOrCtrl+h",
          click: function (item, focusedWindow) {
            mainWindow.webContents.send("triggerFunction", "toggleTodos", ["showCompleted"])
          }
        },
        { type: "separator" },
        {
          label: i18next.t("toggleDarkMode"),
          accelerator: "CmdOrCtrl+d",
          click: function (item, focusedWindow) {
            mainWindow.webContents.send("triggerFunction", "setTheme", [true])
          }
        },
        {
          role: "reload",
          label: i18next.t("reload")
        }
      ]
    },
    {
      label: i18next.t("about"),
      submenu: [
        {
          label: i18next.t("help"),
          click: function () {
            mainWindow.webContents.executeJavaScript("showContent(modalHelp)");
          }
        },
        {
          label: i18next.t("sleekOnGithub"),
          click: () => {require("electron").shell.openExternal("https://github.com/ransome1/sleek")}
        },
        {
          role: "toggleDevTools",
          label: i18next.t("devTools")
        }
      ]
    }
  ];
  // Set menu to menuTemplate
  Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplate))
  // ########################################################################################################################
  // WINDOW CONFIGURATION
  // ########################################################################################################################
  // define OS and use ico on Windows and png on all other OS
  switch (process.platform) {
    case "darwin":
      appData.os = "mac";
      mainWindow.setIcon(path.join(__dirname, "../assets/icons/sleek.png"));
      break;
    case "win32":
      appData.os = "windows";
      mainWindow.setIcon(path.join(__dirname, "../assets/icons/sleek.ico"));
      break;
    default:
      appData.os = "linux";
      mainWindow.setIcon(path.join(__dirname, "../assets/icons/sleek.png"));
      break;
  }
  // show dev tools if in dev mode
  if(isDevelopment) {
    mainWindow.webContents.openDevTools()
  }
  /*if(userData.data.maximizeWindow && appData.os === "windows") {
    mainWindow.maximize();
  } else {
    mainWindow.unmaximize();
  }*/
  if(userData.data.window) mainWindow.setBounds(userData.data.window)
  // and load the index.html of the app.
  mainWindow.loadFile(path.join(__dirname, "index.html"));
  // open links in external browser
  mainWindow.webContents.on("new-window", function(e, url) {
    e.preventDefault();
    require("electron").shell.openExternal(url);
  });
  // every 10 minutes sleek will reload renderer if app is not focused
  // important for notifications to show up if sleek is running for a long time in background
  let timerId = setInterval(() => {
    if(!mainWindow.isFocused()) {
      fileContent(userData.data.file).then(content => {
        mainWindow.webContents.send("refresh", content)
      }).catch(error => {
        console.log(error);
      });
    }
  }, 600000);
  // ########################################################################################################################
  // WINDOW EVENTS
  // ########################################################################################################################
  mainWindow.on('resize', function() {
    userData.set("window", this.getBounds());
  });
  mainWindow.on('move', function() {
    userData.set("window", this.getBounds());
  });
  mainWindow.on('maximize', function() {
    userData.set("maximizeWindow", true);
  });
  mainWindow.on('unmaximize', function() {
    userData.set("maximizeWindow", false);
    userData.set("window", this.getBounds());
  });
  // ########################################################################################################################
  // IPC EVENTS
  // ########################################################################################################################
  // Write config to file
  ipcMain.on("userData", (event, args) => {
    if(args) userData.set(args[0], args[1]);
    mainWindow.webContents.send("userData", userData.data);
  });
  // Send result back to renderer process
  ipcMain.on("appData", (event, args) => {
    mainWindow.webContents.send("appData", appData);
  });
  // Change language
  ipcMain.on("changeLanguage", (event, language) => {
    setLanguage(language).then(response => {
      if(response) {
        console.log(response);
        app.relaunch();
        app.exit();
      }
    }).catch(error => {
      console.log(error);
    });
  });
  // Write content to file
  ipcMain.on("writeToFile", (event, args) => {
    fs.writeFileSync(args[1], args[0], {encoding: 'utf-8'});
  });
  // Open or create file
  ipcMain.on("openOrCreateFile", (event, args) => {
    openDialog(args);
  });
  ipcMain.on("startFileWatcher", (event, file) => {
    startFileWatcher(file).then(response => {
      console.log(response);
    }).catch(error => {
      console.log(error);
    });
  });
  ipcMain.on("fileContent", (event, file) => {
    fileContent(file).then(content => {
      mainWindow.webContents.send("fileContent", content)
    }).catch(error => {
      console.log(error);
    });
  });
  // Send translations back to renderer process
  ipcMain.on("translations", (event, language) => {
    const translations = i18next.getDataByLanguage(language).translation;
    mainWindow.webContents.send("translations", translations)
  });
  // Show a notification in OS UI
  ipcMain.on("showNotification", (event, config) => {
    config.icon = __dirname + "/../assets/icons/96x96.png";
    // send it to UI
    const notification = new Notification(config);
    notification.show();
    // click on button in notification
    notification.addListener('click', () => {
      // trigger matomo event
      if(userData.matomoEvents) _paq.push(["trackEvent", "Notification", "Click on notification"]);
      // bring mainWindow to foreground
      mainWindow.focus();
      // if another modal was open it needs to be closed first and then open the modal and fill it
      mainWindow.webContents.executeJavaScript("resetModal(); showForm(\"" + config.string + "\", false);");
    },{
      // remove event listener after it is clicked once
      once: true
    });
  });
  // Copy text to clipboard
  ipcMain.on("copyToClipboard", (event, args) => {
    if(args[0]) clipboard.writeText(args[0], 'selection')
  });
};
// ########################################################################################################################
// APP EVENTS
// ########################################################################################################################
app.on("ready", () => {
  if(process.platform === 'win32') app.setAppUserModelId("RobinAhle.sleektodomanager")
  createWindow();
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit()
});
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
  app.show();
});