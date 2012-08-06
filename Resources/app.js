var db = require('lib/monglo').Monglo
  , ui = require('lib/Shimmy').UI;

var todo = db.openCollection('todo');

var window = ui.Window({backgroundColor:'#ffffff'});

var title = ui.Label({
  top:5, width:Ti.UI.FIT, height:Ti.UI.FIT,
  text:'JSLA TODO'
});

var input = ui.TextField({
  left:10, right:80, top:50, height:30,
  borderWidth:1, borderColor:'#000000',
  value:''
});

var submit = ui.Button({
  top:50, right:10, width:Ti.UI.FIT, height:Ti.UI.FIT,
  title:'Add'
});

var list = ui.Table({
  top: 100, bottom:50, left:0, right:0
});

var clear = ui.Button({
  bottom:5, width:Ti.UI.FIT, height:Ti.UI.FIT,
  title:'reset'
});

window.add([title,input,submit,list,clear]);

submit.onProxy('click', function(e) {
  list.appendRow({title:input.value});
  todo.insert({title:input.value});
  db.saveCollection('todo');
  input.blur();
  input.value = '';
});

clear.onProxy('click', function(){
  db.clearCollection('todo');
  list.setData([]);
});

window.onProxy('open', function() {
  var items = todo.find().fetch();
  list.setData(items);
});

window.open();
