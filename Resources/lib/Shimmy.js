var _ = exports._ =  require('lib/underscore');
var EventEmitter2 = exports.EventEmitter2 = require('lib/EventEmitter2').EventEmitter2;

var osname = exports.osname = Ti.Platform.osname;

//var tiobjectLogger = {};

exports.getObjCount = function(){
  return tiobjectLogger;
};

/*
 * Wrapper for Titanium UI components.  This wrapper provides a few pieces of critical
 * functionality, currently missing from Titanium UI objects:
 * - The ability to safely extend components with new members
 * - Rudimentary resource management and object lifecycle handling
 */

/**
 * Main Proxy Wrapper
 */

Shimmy.prototype = new EventEmitter2({
      wildcard: true  // should the event emitter use wildcards.
    , maxListeners: 20 // the max number of listeners that can be assigned to an event, defaults to 10.
});

Shimmy.prototype.constructor = Shimmy;

function Shimmy(tiElement) {
  var self = this;
  self.children = [];
  self.proxy = tiElement;
}

/**
 * Mapper - Creates getter and setter mapped to proxy object
 * @param  {string||Object} params String or object { key:'YourObjectKey', value:'ProxysKey' }
 * @return {Object}
 */

Shimmy.prototype.mapper = function(params) {
  var self = this;

  if(!params.length) return Ti.API.error('No parameters provided to Shimmy.proxyProperties');

  //Cycle through properties and create getters and setters
  function next(i) {
    Object.defineProperty(self, params[i].key||params[i],{
      get: function() {
        return self.proxy[params[i].value||params[i]];
      },
      set: function(value) {
        self.proxy[params[i].value||params[i]] = value;
      }
    });
    if(i < (params.length -1)) return next(i+1);
  }
  next(0);
  return self;
};

//Wrappers for common Titanium view construction functions
Shimmy.prototype.add = function(tiChildView) {
  var v;
  if(_.isArray(tiChildView)) {
    for(var x = 0; x < tiChildView.length; x++){
      tiChildView._parent = this;
      v = tiChildView[x].proxy||tiChildView[x];
      v._parent = this;
      this.proxy.add(v);
    }
  } else {
    tiChildView._parent = this;
    v = tiChildView.proxy||tiChildView;
    v._parent = this;
    this.proxy.add(v);
  }
  return this;
};

Shimmy.prototype.remove = function(tiChildView) {
  var v = tiChildView.proxy||tiChildView;
  this.proxy.remove(v);
  tiChildView.proxy = null;
  tiChildView = null;
  return this;
};

Shimmy.prototype.open = function(args) {
  if (this.proxy.open) {
    this.proxy.open(args||{animated:false});
  } else {
    this.proxy.show();
  }
  return this;
};

Shimmy.prototype.show = Shimmy.prototype.open;

Shimmy.prototype.close = function(args) {
  if (this.proxy.close) {
    this.proxy.close(args||{animated:false});
  } else {
    this.proxy.hide();
  }
  return this;
};

Shimmy.prototype.hide = Shimmy.prototype.close;


Shimmy.prototype.animate = function(args,callback) {
  this.proxy.animate(args,callback||function(){});
  return this;
};

Shimmy.prototype.updateLayout = function(args, cb) {
  this.proxy.updateLayout(args);
  return this;
};

//Getter/Setter for the wrapped Titanium view proxy object
Shimmy.prototype.get = function(key) {
  return this.proxy[key];
};

Shimmy.prototype.set = function(key,value) {
  if ('object' === typeof key) this.proxy.updateLayout(key);
  this.proxy[key] = value;
  return this;
};

/**
 * Proxy Specific Event Listeners
 */
Shimmy.prototype.onProxy = function(event,callback) {
  switch (event) {
    case 'location':
      this.globalHandlers.location = callback;
      Ti.Geolocation.addEventListener('location', this.globalHandlers.location);
      break;
    case 'orientationchange':
      this.globalHandlers.orientationchange = callback;
      Ti.Gesture.addEventListener('orientationchange', this.globalHandlers.orientationchange);
      break;
    default:
      this.proxy.addEventListener(event,callback);
      break;
  }
};

/**
 * Proxy Specific Event Emitters
 * @param  {[type]} event [description]
 * @param  {[type]} data  [description]
 * @return {[type]}       [description]
 */

Shimmy.prototype.emitProxy = function(event,data) {
  this.proxy.fireEvent(event,data||{});
};

//This should be overridden by any Shimmys which wish to execute custom
//clean up logic, to release their child components, etc.
Shimmy.prototype.onDestroy = function() {};

//Clean up resources used by this Shimmy
Shimmy.prototype.release = function() {
  //force cleanup on proxy
  if(this._parent) this._parent.remove(this);
  this.proxy = null;

  //run custom cleanup logic
  this.onDestroy();
};

/**
 * UI Specific Functions
 */

// Hack To Make Sure Titanium Includes the required modules.
// Add all modules that you use in Shimmy
var used = [Titanium.UI.createLabel, Titanium.UI.createWebView, Ti.Platform.locale ,
 Ti.UI.createWindow, Ti.UI.createLabel, Ti.UI.createView,
 Ti.UI.createTableView, Ti.UI.createTableViewRow, Ti.UI.createTableViewSection,
 Ti.UI.createButton, Ti.UI.createButton, Ti.UI.createImageView, Ti.UI.createTextField,
 Ti.UI.createTextArea, Ti.UI.iPhone.NavigationGroup, Ti.UI.createPicker, Ti.UI.createPickerRow,
 Ti.UI.iPhone.SystemButtonStyle, Ti.UI.createOptionDialog, Ti.Facebook, Ti.Contacts, Ti.UI.createScrollableView];

function ui(tiElement, args){
  var self;

  if ('string' !== typeof tiElement) {
    //If Shimmy is passed a Titanium Object
    self = tiElement(args);
  } else {
    //Build Titanium Proxy Object Creation Call
    var tiobject = (args && args.platform) ? Ti.UI[args.platform]['create'+tiElement] : Ti.UI['create'+tiElement];
    self = tiobject(args||{});
  }
  var shimmyObject = new Shimmy(self);

  return shimmyObject;
}

ui.Alert = function (params) {
  var properties = ['title','message'];
  var self = ui('AlertDialog', params).mapper(properties);
  return self;
};

ui.Button = function (params) {
  var properties = ['top','bottom','left','right','height','width','color','font','title'];
  var self = ui('Button', params).mapper(properties);
  return self;
};

ui.ButtonBar = function(params) {
  var self = ui('View', params);
  return self;
};

ui.CoverFlow = function(params) {
  var self = ui('CoverFlowView', params);
  return self;
};

ui.DashIcon = function(params) {
  var self = ui('DashboardItem', params);
  return self;
};

ui.DashBoard = function(params) {
  var self = ui('DashboardView', params);
  return self;
};

ui.EmailDialog = function(params) {
  var self = ui('EmailDialog', params);
  return self;
};

ui.Image = function(params) {
  var properties = ['top','bottom','left','right','height','width','color','image','visible',{key:'value', value:'image'}];
  var self = ui('ImageView',  _.extend({
    height:Ti.UI.SIZE,
    width:Ti.UI.SIZE
  },params||{})).mapper(properties);

  return self;
};

ui.Label = function(params) {
  var properties = ['top','bottom','left','right','height','width','color','font','text','visible',{key:'value',value:'text'},'data'];
  var self = ui('Label',_.extend({
    text:params.text,
    color:'#000',
    height:20,
    width:Ti.UI.SIZE,
    font: {
      fontFamily: (osname === 'android') ? 'Droid Sans' : 'Helvetica Neue',
      fontSize: 14
    }
  },params||{})).mapper(properties);

  return self;
};

ui.Map = function(params) {
  var self = ui(Ti.Map.createView,params);
  return self;
};

ui.NavGroup = function(params) {
  //Hard coded platform until Android and Mobile Web NavigationGroup shim is made
  var isiPhone = (osname == 'iphone');
  var window = params.window;
  params.window = params.window.proxy;
  params.platform = (isiPhone) ? 'iPhone': null;
  var self = (isiPhone) ? ui('NavigationGroup',params) : window;

  self.open = function(win, params) {
    win.navGroup = self;
    win._parent = params.parent;
    win._data = params;
    if(isiPhone){
      self.proxy.open(win.proxy,{animate:true});
    } else {
      var btn = ui.Button({height:50,width:50, left:5,top:5});
      win.add(btn);
      btn.onProxy('click', function(){win.close();});
      win.open();
    }
  };

  self.close = function(win, params) {
    if(isiPhone){
    self.proxy.close(win.proxy,params);
    } else {
      win.close();
    }
  };

  return self;
};

ui.OptionDialog = function(params) {
  var self = ui('OptionDialog', params);

  self.show = function(){
    self.proxy.show();
  };

  return self;
};

ui.Picker = function(params) {
  var self = ui('Picker', params);
  return self;
};

ui.Row = function(params) {
  var self = ui('TableViewRow', params);
  return self;
};

ui.ScrollableView = function(params) {
  var self = ui('ScrollableView', params);
  return self;
};

ui.ScrollView = function(params) {
  var self = ui('ScrollView', params);
  return self;
};

ui.TabGroup = function(params) {
  var tabs = params.tabs;

  delete params.tabs;

  var self = ui('TabGroup', params);

  function next(i) {
    var tab = Ti.UI.createTab({
        icon:tabs[i].icon,
        title:tabs[i].title,
        window: tabs[i].window
    });
    self.proxy.addTab(tab);
    if (i < tabs.length -1) next(i+1);
  }
  next(0);

  return self;
};

ui.Table = function(args) {
  var properties = ['top','bottom','left','right','height','width','visible','data'];

  var dataRows = [];

  if(args.data) {
    dataRows  = args.data;
    delete args.data;
  }

  var self = ui('TableView', args);

  Object.defineProperty(self, 'data',{
    get: function() {
      return data;
    },
    set: function(value) {
      var v = [];
      for(var x = 0; x < value.length; x++){
        v.push(value[x].proxy||value[x]);
      }
      self.proxy.data = v;
    }
  });

  self.data = dataRows;

  self.empty = function() {
    self.proxy.setData();
    return self;
  };

  self.setData = function(tiChildRow) {
    var v = [];
    for(var x = 0; x < tiChildRow.length; x++){
      v.push(tiChildRow[x].proxy||tiChildRow[x]);
    }
    self.proxy.data = v;
    return self;
  };

  self.appendRow = function(row) {
    var r = row.proxy||row;
    self.proxy.appendRow(r);
    return self;
  };

  return self;
};

ui.TableSection = function(params) {
  var self = ui('TableViewSection', params);
  return self;
};

ui.TextArea = function(params) {
  var properties = ['top','bottom','left','right','height','width','value','data'];
  var self = ui('TextArea', params).mapper(properties);
  return self;
};

ui.TextField = function(params) {
  var properties = ['top','bottom','left','right','height','width','value','data'];
  var self = ui('TextField', params).mapper(properties);
  self.blur = function(){ self.proxy.blur(); };
  return self;
};

ui.Toolbar = function(params) {
  var self = ui('Toolbar', params);
  return self;
};

ui.View = function(params) {
  var properties = ['top','bottom','left','right','height','width','backgroundImage','backgroundColor', 'borderWidth','borderColor', 'layout', 'children','visible'];
  var self = ui('View', params).mapper(properties);
  return self;
};

ui.WebView = function(params) {
  var self = ui('WebView', params);
  return self;
};

ui.Window = function(params) {
  var properties = ['top','bottom','left','right','height','width','backgroundImage','children'];
  var self = ui('Window', params).mapper(properties);

  self.NavButtons = function(params) {
   for(var x in params){
      switch(typeof params[x]) {
        case 'string':
        case 'number':
          self[x+'NavButton'] = ui.Button({title:params[x]});
          self.proxy[x+'NavButton'] = self[x+'NavButton'].proxy;
          break;
        case 'object':
          self[x+'NavButton'] = params[x];
          self.proxy[x+'NavButton'] = self[x+'NavButton'].proxy;
          break;
        default:
          break;
      }
   }
    // Return self to allow for chaining
    return self;
  };

  return self;
};

exports.UI = ui;

//adding to public interface
exports.Shimmy = Shimmy;