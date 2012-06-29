/*!
 * Monglo
 * Copyright (c) 2012 Christian Sullivan <cs@euforic.co>
 * MIT Licensed
 */
var DEFAULT_FS_DIR = ('object' ===typeof Titanium) ? Titanium.Filesystem.applicationDataDirectory : null;

var Monglo = {};

Monglo.open = function(name /*database name*/){
  //Load all collections for the given database
  //throw new Error('Not yet implemented');
}

Monglo.Collection = function(name){
  if(Monglo.hasOwnProperty(name)){
    throw new Error('Invalid Collection Name: "'+name+'" This is a reserved name!');
  };
  Monglo[name] =  new Collection(name);
  if(!Monglo[name].open()){
    Monglo._debug('No file found for collection.');
  }
  return Monglo[name];
}

Monglo.createCollection = function(name){
  if(Monglo.hasOwnProperty(name)){
    throw new Error('Invalid Collection Name: "'+name+'" This is a reserved name!');
  };
  Monglo[name] =  new Collection(name);
  return Monglo[name];
};

Monglo.openCollection = function(name){
  Monglo[name] =  new Collection(name);
  if(!Monglo[name].open()){
    console.error('No file found for collection.');
  }
  return Monglo[name];
};

Monglo.saveCollection = function(name){
  Monglo[name].commit();
  return Monglo[name];
};

Monglo.removeCollection = function(name){
  Monglo[name].drop();
  delete Monglo[name];
  return Monglo;
};

Monglo.clearCollection = function(name){
  //Reset collection contents
  Monglo[name].docs = {};
  return Monglo;
};

Monglo._debug = function(data){
  //Reset collection contents
};

exports.Monglo = Monglo;

// XXX type checking on selectors (graceful error if malformed)

// Collection: a set of documents that supports queries and modifiers.

// Cursor: a specification for a particular subset of documents, w/
// a defined order, limit, and offset.  creating a Cursor with Collection.find(),

// LiveResultsSet: the return value of a live query.

var Collection = function (name) {
  this.name = name;
  this.docs = {}; // _id -> document (also containing id)

  this.next_qid = 1; // live query id generator

  // qid -> live query object. keys:
  //  results: array of current results
  //  results_snapshot: snapshot of results. null if not paused.
  //  cursor: Cursor object for the query.
  //  selector_f, sort_f, (callbacks): functions
  this.queries = {};

  // when we have a snapshot, this will contain a deep copy of 'docs'.
  this.current_snapshot = null;

  // True when observers are paused and we should not send callbacks.
  this.paused = false;
};

Collection.prototype = new EventEmitter();

Collection.prototype.constructor = Collection;

Collection.prototype.commit = function(path) {
  if('object' !== typeof Titanium) {
    //Monglo._debug('Function not Implemented for the given platform');
    return false;
  }
  var self = this;
  var filename = self.name;
  filename += '.json';
  if(path == undefined) {
    path = DEFAULT_FS_DIR;
  }
  var file = Titanium.Filesystem.getFile(path, filename);
  file.write(JSON.stringify(self.docs));
  return true;
};

Collection.prototype.open = function(path) {
  if('object' !== typeof Titanium) {
    //Monglo._debug('Function not Implemented for the given platform');
    return false;
  }
  var self = this;
  var filename = self.name;
  if(path == undefined) {
    path = DEFAULT_FS_DIR;
  }
  filename += '.json';
  var file = Titanium.Filesystem.getFile(path, filename);
  if (file.exists()) {
    var data = JSON.parse(file.read());
    self.docs = data;
    return Monglo;
  }
  return false;
};

Collection.prototype.drop = function(path) {
  if('object' !== typeof Titanium) {
    //Monglo._debug('Function not Implemented for the given platform');
    return false;
  }
  var self = this;
  var filename = self.name;
  filename += '.json';
  if(path == undefined) {
    path = DEFAULT_FS_DIR;
  }
  var file = Titanium.Filesystem.getFile(path, filename);
  file.deleteFile();

  return true;
};

// options may include sort, skip, limit, reactive
// sort may be any of these forms:
//     {a: 1, b: -1}
//     [["a", "asc"], ["b", "desc"]]
//     ["a", ["b", "desc"]]
//   (in the first form you're beholden to key enumeration order in
//   your javascript VM)
//
// reactive: if given, and false, don't register with Monglo.deps (default
// is true)
//
// XXX possibly should support retrieving a subset of fields? and
// have it be a hint (ignored on the client, when not copying the
// doc?)
//
// XXX sort does not yet support subkeys ('a.b') .. fix that!
// XXX add one more sort form: "key"
// XXX tests
Collection.prototype.find = function (selector, options) {
  // default syntax for everything is to omit the selector argument.
  // but if selector is explicitly passed in as false or undefined, we
  // want a selector that matches nothing.
  if (arguments.length === 0)
    selector = {};

  return new Collection.Cursor(this, selector, options);
};

// don't call this ctor directly.  use Collection.find().
Collection.Cursor = function (collection, selector, options) {
  if (!options) options = {};

  this.collection = collection;

  if ((typeof selector === "string") || (typeof selector === "number")) {
    // stash for fast path
    this.selector_id = selector;
    this.selector_f = Collection._compileSelector(selector);
  } else {
    this.selector_f = Collection._compileSelector(selector);
    this.sort_f = options.sort ? Collection._compileSort(options.sort) : null;
    this.skip = options.skip;
    this.limit = options.limit;
  }

  this.db_objects = null;
  this.cursor_pos = 0;

  // by default, queries register w/ Monglo.deps when it is available.
  if (typeof Monglo === "object" && Monglo.deps)
    this.reactive = (options.reactive === undefined) ? true : options.reactive;
};

Collection.Cursor.prototype.rewind = function () {
  var self = this;
  self.db_objects = null;
  self.cursor_pos = 0;
};

Collection.prototype.findOne = function (selector, options) {
  if (arguments.length === 0)
    selector = {};

  // XXX disable limit here so that we can observe findOne() cursor,
  // as required by markAsReactive.
  // options = options || {};
  // options.limit = 1;
  return this.find(selector, options).fetch()[0];
};

Collection.Cursor.prototype.forEach = function (callback) {
  var self = this;
  var doc;

  if (self.db_objects === null)
    self.db_objects = self._getRawObjects();

  if (self.reactive)
    self._markAsReactive({added: true,
                          removed: true,
                          changed: true,
                          moved: true});

  while (self.cursor_pos < self.db_objects.length)
    callback(Collection._deepcopy(self.db_objects[self.cursor_pos++]));
};

Collection.Cursor.prototype.map = function (callback) {
  var self = this;
  var res = [];
  self.forEach(function (doc) {
    res.push(callback(doc));
  });
  return res;
};

Collection.Cursor.prototype.fetch = function () {
  var self = this;
  var res = [];
  self.forEach(function (doc) {
    res.push(doc);
  });
  return res;
};

Collection.Cursor.prototype.count = function () {
  var self = this;

  if (self.reactive)
    self._markAsReactive({added: true, removed: true});

  if (self.db_objects === null)
    self.db_objects = self._getRawObjects();

  return self.db_objects.length;
};

// the handle that comes back from observe.
Collection.LiveResultsSet = function () {};

// options to contain:
//  * callbacks:
//    - added (object, before_index)
//    - changed (new_object, at_index, old_object)
//    - moved (object, old_index, new_index) - can only fire with changed()
//    - removed (id, at_index, object)
//
// attributes available on returned query handle:
//  * stop(): end updates
//  * collection: the collection this query is querying
//
// iff x is a returned query handle, (x instanceof
// Collection.LiveResultsSet) is true
//
// initial results delivered through added callback
// XXX maybe callbacks should take a list of objects, to expose transactions?
// XXX maybe support field limiting (to limit what you're notified on)
// XXX maybe support limit/skip
// XXX it'd be helpful if removed got the object that just left the
// query, not just its id

Collection.Cursor.prototype.observe = function (options) {
  var self = this;

  if (self.skip || self.limit)
    throw new Error("cannot observe queries with skip or limit");

  var qid = self.collection.next_qid++;

  // XXX merge this object w/ "this" Cursor.  they're the same.
  var query = self.collection.queries[qid] = {
    selector_f: self.selector_f, // not fast pathed
    sort_f: self.sort_f,
    results: [],
    results_snapshot: self.collection.paused ? [] : null,
    cursor: this
  };
  query.results = self._getRawObjects();

  // wrap callbacks we were passed. callbacks only fire when not paused
  // and are never undefined.
  var if_not_paused = function (f) {
    if (!f)
      return function () {};
    return function (/*args*/) {
      if (!self.collection.paused)
        f.apply(this, arguments);
    };
  };
  query.added = if_not_paused(options.added);
  query.changed = if_not_paused(options.changed);
  query.moved = if_not_paused(options.moved);
  query.removed = if_not_paused(options.removed);

  if (!options._suppress_initial && !self.collection.paused)
    for (var i = 0; i < query.results.length; i++)
      query.added(Collection._deepcopy(query.results[i]), i);

  var handle = new Collection.LiveResultsSet;
  _.extend(handle, {
    collection: self.collection,
    stop: function () {
      delete self.collection.queries[qid];
    }
  });
  return handle;
};

// constructs sorted array of matching objects, but doesn't copy them.
// respects sort, skip, and limit properties of the query.
// if sort_f is falsey, no sort -- you get the natural order
Collection.Cursor.prototype._getRawObjects = function () {
  var self = this;

  // fast path for single ID value
  if (self.selector_id && (self.selector_id in self.collection.docs))
    return [self.collection.docs[self.selector_id]];

  // slow path for arbitrary selector, sort, skip, limit
  var results = [];
  for (var id in self.collection.docs) {
    var doc = self.collection.docs[id];
    if (self.selector_f(doc))
      results.push(doc);
  }

  if (self.sort_f)
    results.sort(self.sort_f);

  var idx_start = self.skip || 0;
  var idx_end = self.limit ? (self.limit + idx_start) : results.length;
  return results.slice(idx_start, idx_end);
};

Collection.Cursor.prototype._markAsReactive = function (options) {
  var self = this;

  var context = Monglo.deps.Context.current;

  if (context) {
    var invalidate = _.bind(context.invalidate, context);

    var handle = self.observe({added: options.added && invalidate,
                               removed: options.removed && invalidate,
                               changed: options.changed && invalidate,
                               moved: options.moved && invalidate,
                               _suppress_initial: true});

    // XXX in many cases, the query will be immediately
    // recreated. so we might want to let it linger for a little
    // while and repurpose it if it comes back. this will save us
    // work because we won't have to redo the initial find.
    context.on_invalidate(handle.stop);
  }
};

// XXX enforce rule that field names can't start with '$' or contain '.'
// (real mongodb does in fact enforce this)
// XXX possibly enforce that 'undefined' does not appear (we assume
// this in our handling of null and $exists)
Collection.prototype.insert = function (doc,cb) {
  var self = this;
  doc = Collection._deepcopy(doc);
  // XXX deal with mongo's binary id type?
  if (!('_id' in doc))
    doc._id = ObjectId();
  // XXX check to see that there is no object with this _id yet?
  self.docs[doc._id] = doc;

  // trigger live queries that match
  for (var qid in self.queries) {
    var query = self.queries[qid];
    if (query.selector_f(doc))
      Collection._insertInResults(query, doc);
  }
  if(cb){ return cb(doc); }
};

Collection.prototype.remove = function (selector) {
  var self = this;
  var remove = [];
  var query_remove = [];

  var selector_f = Collection._compileSelector(selector);
  for (var id in self.docs) {
    var doc = self.docs[id];
    if (selector_f(doc)) {
      remove.push(id);
      for (var qid in self.queries) {
        var query = self.queries[qid];
        if (query.selector_f(doc))
          query_remove.push([query, doc]);
      }
    }
  }
  for (var i = 0; i < remove.length; i++) {
    delete self.docs[remove[i]];
  }

  // run live query callbacks _after_ we've removed the documents.
  for (var i = 0; i < query_remove.length; i++) {
    Collection._removeFromResults(query_remove[i][0], query_remove[i][1]);
  }
};

// XXX atomicity: if multi is true, and one modification fails, do
// we rollback the whole operation, or what?
Collection.prototype.update = function (selector, mod, options) {
  if (!options) options = {};

  var self = this;
  var any = false;
  var selector_f = Collection._compileSelector(selector);
  for (var id in self.docs) {
    var doc = self.docs[id];
    if (selector_f(doc)) {
      self._modifyAndNotify(doc, mod);
      if (!options.multi)
        return;
      any = true;
    }
  }

  if (options.upsert) {
    throw Error("upsert not yet implemented");
  }

  if (options.upsert && !any) {
    // XXX is this actually right? don't we have to resolve/delete
    // $-ops or something like that?
    insert = Collection._deepcopy(selector);
    Collection._modify(insert, mod);
    self.insert(insert);
  }
};

Collection.prototype._modifyAndNotify = function (doc, mod) {
  var self = this;

  var matched_before = {};
  for (var qid in self.queries)
    matched_before[qid] = self.queries[qid].selector_f(doc);

  var old_doc = Collection._deepcopy(doc);

  Collection._modify(doc, mod);

  for (var qid in self.queries) {
    var query = self.queries[qid];
    var before = matched_before[qid];
    var after = query.selector_f(doc);
    if (before && !after)
      Collection._removeFromResults(query, doc);
    else if (!before && after)
      Collection._insertInResults(query, doc);
    else if (before && after)
      Collection._updateInResults(query, doc, old_doc);
  }
};

// XXX findandmodify

Collection._deepcopy = function (v) {
  if (typeof v !== "object")
    return v;
  if (v === null)
    return null; // null has typeof "object"
  if (_.isArray(v)) {
    var ret = v.slice(0);
    for (var i = 0; i < v.length; i++)
      ret[i] = Collection._deepcopy(ret[i]);
    return ret;
  }
  var ret = {};
  for (var key in v)
    ret[key] = Collection._deepcopy(v[key]);
  return ret;
};

// XXX the sorted-query logic below is laughably inefficient. we'll
// need to come up with a better datastructure for this.

Collection._insertInResults = function (query, doc) {
  if (!query.sort_f) {
    query.added(Collection._deepcopy(doc), query.results.length);
    query.results.push(doc);
  } else {
    var i = Collection._insertInSortedList(query.sort_f, query.results, doc);
    query.added(Collection._deepcopy(doc), i);
  }
};

Collection._removeFromResults = function (query, doc) {
  var i = Collection._findInResults(query, doc);
  query.removed(doc, i);
  query.results.splice(i, 1);
};

Collection._updateInResults = function (query, doc, old_doc) {
  var orig_idx = Collection._findInResults(query, doc);
  query.changed(Collection._deepcopy(doc), orig_idx, old_doc);

  if (!query.sort_f)
    return;

  // just take it out and put it back in again, and see if the index
  // changes
  query.results.splice(orig_idx, 1);
  var new_idx = Collection._insertInSortedList(query.sort_f,
                                               query.results, doc);
  if (orig_idx !== new_idx)
    query.moved(Collection._deepcopy(doc), orig_idx, new_idx);
};

Collection._findInResults = function (query, doc) {
  for (var i = 0; i < query.results.length; i++)
    if (query.results[i] === doc)
      return i;
  throw Error("object missing from query");
};

Collection._insertInSortedList = function (cmp, array, value) {
  if (array.length === 0) {
    array.push(value);
    return 0;
  }

  for (var i = 0; i < array.length; i++) {
    if (cmp(value, array[i]) < 0) {
      array.splice(i, 0, value);
      return i;
    }
  }

  array.push(value);
  return array.length - 1;
};

// At most one snapshot can exist at once. If one already existed,
// overwrite it.
// XXX document (at some point)
// XXX test
// XXX obviously this particular implementation will not be very efficient
Collection.prototype.snapshot = function () {
  this.current_snapshot = {};
  for (var id in this.docs)
    this.current_snapshot[id] = JSON.parse(JSON.stringify(this.docs[id]));
};

// Restore (and destroy) the snapshot. If no snapshot exists, raise an
// exception.
// XXX document (at some point)
// XXX test
Collection.prototype.restore = function () {
  if (!this.current_snapshot)
    throw new Error("No current snapshot");
  this.docs = this.current_snapshot;
  this.current_snapshot = null;

  // Rerun all queries from scratch. (XXX should do something more
  // efficient -- diffing at least; ideally, take the snapshot in an
  // efficient way, say with an undo log, so that we can efficiently
  // tell what changed).
  for (var qid in this.queries) {
    var query = this.queries[qid];

    var old_results = query.results;

    query.results = query.cursor._getRawObjects();

    if (!this.paused)
      Collection._diffQuery(old_results, query.results, query, true);
  }
};


// Pause the observers. No callbacks from observers will fire until
// 'resumeObservers' is called.
Collection.prototype.pauseObservers = function () {
  // No-op if already paused.
  if (this.paused)
    return;

  // Set the 'paused' flag such that new observer messages don't fire.
  this.paused = true;

  // Take a snapshot of the query results for each query.
  for (var qid in this.queries) {
    var query = this.queries[qid];

    query.results_snapshot = Collection._deepcopy(query.results);
  }
};

// Resume the observers. Observers immediately receive change
// notifications to bring them to the current state of the
// database. Note that this is not just replaying all the changes that
// happened during the pause, it is a smarter 'coalesced' diff.
Collection.prototype.resumeObservers = function () {
  // No-op if not paused.
  if (!this.paused)
    return;

  // Unset the 'paused' flag. Make sure to do this first, otherwise
  // observer methods won't actually fire when we trigger them.
  this.paused = false;

  for (var qid in this.queries) {
    var query = this.queries[qid];
    // Diff the current results against the snapshot and send to observers.
    // pass the query object for its observer callbacks.
    Collection._diffQuery(query.results_snapshot, query.results, query, true);
    query.results_snapshot = null;
  }

};

// old_results: array of documents.
// new_results: array of documents.
// observer: object with 'added', 'changed', 'moved',
//           'removed' functions (each optional)
// deepcopy: if true, elements of new_results that are passed to callbacks are
//          deepcopied first
Collection._diffQuery = function (old_results, new_results, observer, deepcopy) {

  var new_presence_of_id = {};
  _.each(new_results, function (doc) {
    if (new_presence_of_id[doc._id])
      Monglo._debug("Duplicate _id in new_results");
    new_presence_of_id[doc._id] = true;
  });

  var old_index_of_id = {};
  _.each(old_results, function (doc, i) {
    if (doc._id in old_index_of_id)
      Monglo._debug("Duplicate _id in old_results");
    old_index_of_id[doc._id] = i;
  });

  // "maybe deepcopy"
  var mdc = (deepcopy ? Collection._deepcopy : _.identity);

  // ALGORITHM:
  //
  // We walk old_idx through the old_results array and
  // new_idx through the new_results array at the same time.
  // These pointers establish a sort of correspondence between
  // old docs and new docs (identified by their _ids).
  // If they point to the same doc (i.e. old and new docs
  // with the same _id), we can increment both pointers
  // and fire no 'moved' callbacks.  Otherwise, we must
  // increment one or the other and fire approprate 'added',
  // 'removed', and 'moved' callbacks.
  //
  // The process is driven by new_results, in that we try
  // make the observer's array look like new_results by
  // establishing each new doc in order.  The doc pointed
  // to by new_idx is the one we are trying to establish
  // at any given time.  If it doesn't exist in old_results,
  // we fire an 'added' callback.  If it does, we have a
  // choice of two ways to handle the situation.  We can
  // advance old_idx forward to the corresponding old doc,
  // treating all intervening old docs as moved or removed,
  // and the current doc as unmoved.  Or, we can simply
  // establish the new doc as next by moving it into place,
  // i.e. firing a single 'moved' callback to move the
  // doc from wherever it was before.  Generating a sequence
  // of 'moved' callbacks that is not just correct but small
  // (or minimal) is a matter of choosing which elements
  // to consider moved and which ones merely change position
  // by virtue of the movement of other docs.
  //
  // Calling callbacks with correct indices requires understanding
  // what the observer's array looks like at each iteration.
  // The observer's array is a concatenation of:
  // - new_results up to (but not including) new_idx, with the
  //   addition of some "bumped" docs that we are later going
  //   to move into place
  // - old_results starting at old_idx, minus any docs that we
  //   have already moved ("taken" docs)
  //
  // To keep track of "bumped" items -- docs in the observer's
  // array that we have skipped over, but will be moved forward
  // later when we get to their new position -- we keep a
  // "bump list" of indices into new_results where bumped items
  // occur.  [The idea is that by adding an item to the list (bumping
  // it), we can consider it dealt with, even though it is still there.]
  // The corresponding position of new_idx in the observer's array,
  // then, is new_idx + bump_list.length, and the position of
  // the nth bumped item in the observer's array is
  // bump_list[n] + n (to account for the previous bumped items
  // that are still there).
  //
  // A "taken" list is used in a sort of analogous way to track
  // the indices of the documents after old_idx in old_results
  // that we have moved, so that, conversely, even though we will
  // come across them in old_results, they are actually no longer
  // in the observer's array.
  //
  // To determine which docs should be considered "moved" (and which
  // merely change position because of other docs moving) we run
  // a "longest common subsequence" (LCS) algorithm.  The LCS of the
  // old doc IDs and the new doc IDs gives the docs that should NOT be
  // considered moved.
  //
  // Overall, this diff implementation is asymptotically good, but could
  // be optimized to streamline execution and use less memory (e.g. not
  // have to build data structures with an entry for every doc).

  // Asymptotically: O(N k) where k is number of ops, or potentially
  // O(N log N) if inner loop of LCS were made to be binary search.


  //////// LCS (longest common sequence, with respect to _id)
  // (see Wikipedia article on Longest Increasing Subsequence,
  // where the LIS is taken of the sequence of old indices of the
  // docs in new_results)
  //
  // unmoved_set: the output of the algorithm; members of the LCS,
  // in the form of indices into new_results
  var unmoved_set = {};
  // max_seq_len: length of LCS found so far
  var max_seq_len = 0;
  // seq_ends[i]: the index into new_results of the last doc in a
  // common subsequence of length of i+1 <= max_seq_len
  var N = new_results.length;
  var seq_ends = new Array(N);
  // ptrs:  the common subsequence ending with new_results[n] extends
  // a common subsequence ending with new_results[ptr[n]], unless
  // ptr[n] is -1.
  var ptrs = new Array(N);
  // virtual sequence of old indices of new results
  var old_idx_seq = function(i_new) {
    return old_index_of_id[new_results[i_new]._id];
  };
  // for each item in new_results, use it to extend a common subsequence
  // of length j <= max_seq_len
  for(var i=0; i<N; i++) {
    if (old_index_of_id[new_results[i]._id] !== undefined) {
      var j = max_seq_len;
      // this inner loop would traditionally be a binary search,
      // but scanning backwards we will likely find a subseq to extend
      // pretty soon, bounded for example by the total number of ops.
      // If this were to be changed to a binary search, we'd still want
      // to scan backwards a bit as an optimization.
      while (j > 0) {
        if (old_idx_seq(seq_ends[j-1]) < old_idx_seq(i))
          break;
        j--;
      }

      ptrs[i] = (j === 0 ? -1 : seq_ends[j-1]);
      seq_ends[j] = i;
      if (j+1 > max_seq_len)
        max_seq_len = j+1;
    }
  }

  // pull out the LCS/LIS into unmoved_set
  var idx = (max_seq_len === 0 ? -1 : seq_ends[max_seq_len-1]);
  while (idx >= 0) {
    unmoved_set[idx] = true;
    idx = ptrs[idx];
  }

  //////// Main Diff Algorithm

  var old_idx = 0;
  var new_idx = 0;
  var bump_list = [];
  var bump_list_old_idx = [];
  var taken_list = [];

  var scan_to = function(old_j) {
    // old_j <= old_results.length (may scan to end)
    while (old_idx < old_j) {
      var old_doc = old_results[old_idx];
      var is_in_new = new_presence_of_id[old_doc._id];
      if (! is_in_new) {
        observer.removed && observer.removed(old_doc, new_idx + bump_list.length);
      } else {
        if (taken_list.length >= 1 && taken_list[0] === old_idx) {
          // already moved
          taken_list.shift();
        } else {
          // bump!
          bump_list.push(new_idx);
          bump_list_old_idx.push(old_idx);
        }
      }
      old_idx++;
    }
  };


  while (new_idx <= new_results.length) {
    if (new_idx < new_results.length) {
      var new_doc = new_results[new_idx];
      var old_doc_idx = old_index_of_id[new_doc._id];
      if (old_doc_idx === undefined) {
        // insert
        observer.added && observer.added(mdc(new_doc), new_idx + bump_list.length);
      } else {
        var old_doc = old_results[old_doc_idx];
        //var is_unmoved = (old_doc_idx > old_idx); // greedy; not minimal
        var is_unmoved = unmoved_set[new_idx];
        if (is_unmoved) {
          if (old_doc_idx < old_idx)
            Monglo._debug("Assertion failed while diffing: nonmonotonic lcs data");
          // no move
          scan_to(old_doc_idx);
          if (! _.isEqual(old_doc, new_doc)) {
            observer.changed && observer.changed(
              mdc(new_doc), new_idx + bump_list.length, old_doc);
          }
          old_idx++;
        } else {
          // move into place
          var to_idx = new_idx + bump_list.length;
          var from_idx;
          if (old_doc_idx >= old_idx) {
            // move backwards
            from_idx = to_idx + old_doc_idx - old_idx;
            // must take number of "taken" items into account; also use
            // results of this binary search to insert new taken_list entry
            var num_taken_before = _.sortedIndex(taken_list, old_doc_idx);
            from_idx -= num_taken_before;
            taken_list.splice(num_taken_before, 0, old_doc_idx);
          } else {
            // move forwards, from bump list
            // (binary search applies)
            var b = _.indexOf(bump_list_old_idx, old_doc_idx, true);
            if (b < 0)
              Monglo._debug("Assertion failed while diffing: no bumped item");
            from_idx = bump_list[b] + b;
            to_idx--;
            bump_list.splice(b, 1);
            bump_list_old_idx.splice(b, 1);
          }
          if (from_idx != to_idx)
            observer.moved && observer.moved(mdc(old_doc), from_idx, to_idx);
          if (! _.isEqual(old_doc, new_doc)) {
            observer.changed && observer.changed(mdc(new_doc), to_idx, old_doc);
          }
        }
      }
    } else {
      scan_to(old_results.length);
    }
    new_idx++;
  }
  if (bump_list.length > 0) {
    Monglo._debug(old_results);
    Monglo._debug(new_results);
    Monglo._debug("Assertion failed while diffing: leftover bump_list "+
                  bump_list);
  }

};

// XXX need a strategy for passing the binding of $ into this
// function, from the compiled selector
//
// maybe just {key.up.to.just.before.dollarsign: array_index}
//
// XXX atomicity: if one modification fails, do we roll back the whole
// change?
Collection._modify = function (doc, mod) {
  var is_modifier = false;
  for (var k in mod) {
    // IE7 doesn't support indexing into strings (eg, k[0]), so use substr.
    // Too bad -- it's far slower:
    // http://jsperf.com/testing-the-first-character-of-a-string
    is_modifier = k.substr(0, 1) === '$';
    break; // just check the first key.
  }

  var new_doc;

  if (!is_modifier) {
    if (mod._id && doc._id !== mod._id)
      throw Error("Cannot change the _id of a document");

    // replace the whole document
    for (var k in mod) {
      if (k.substr(0, 1) === '$')
        throw Error("Field name may not start with '$'");
      if (/\./.test(k))
        throw Error("Field name may not contain '.'");
    }
    new_doc = mod;
  } else {
    // apply modifiers
    var new_doc = Collection._deepcopy(doc);

    for (var op in mod) {
      var mod_func = Collection._modifiers[op];
      if (!mod_func)
        throw Error("Invalid modifier specified " + op);
      for (var keypath in mod[op]) {
        // XXX mongo doesn't allow mod field names to end in a period,
        // but I don't see why.. it allows '' as a key, as does JS
        if (keypath.length && keypath[keypath.length-1] === '.')
          throw Error("Invalid mod field name, may not end in a period");

        var arg = mod[op][keypath];
        var keyparts = keypath.split('.');
        var no_create = !!Collection._noCreateModifiers[op];
        var forbid_array = (op === "$rename");
        var target = Collection._findModTarget(new_doc, keyparts,
                                                    no_create, forbid_array);
        var field = keyparts.pop();
        mod_func(target, field, arg, keypath, new_doc);
      }
    }
  }

  // move new document into place
  for (var k in doc) {
    if (k !== '_id')
      delete doc[k];
  }
  for (var k in new_doc) {
    doc[k] = new_doc[k];
  }
};

// for a.b.c.2.d.e, keyparts should be ['a', 'b', 'c', '2', 'd', 'e'],
// and then you would operate on the 'e' property of the returned
// object. if no_create is falsey, creates intermediate levels of
// structure as necessary, like mkdir -p (and raises an exception if
// that would mean giving a non-numeric property to an array.) if
// no_create is true, return undefined instead. may modify the last
// element of keyparts to signal to the caller that it needs to use a
// different value to index into the returned object (for example,
// ['a', '01'] -> ['a', 1]). if forbid_array is true, return null if
// the keypath goes through an array.
Collection._findModTarget = function (doc, keyparts, no_create,
                                      forbid_array) {
  for (var i = 0; i < keyparts.length; i++) {
    var last = (i === keyparts.length - 1);
    var keypart = keyparts[i];
    var numeric = /^[0-9]+$/.test(keypart);
    if (no_create && (!(typeof doc === "object") || !(keypart in doc)))
      return undefined;
    if (doc instanceof Array) {
      if (forbid_array)
        return null;
      if (!numeric)
        throw Error("can't append to array using string field name ["
                    + keypart + "]");
      keypart = parseInt(keypart);
      if (last)
        // handle 'a.01'
        keyparts[i] = keypart;
      while (doc.length < keypart)
        doc.push(null);
      if (!last) {
        if (doc.length === keypart)
          doc.push({});
        else if (typeof doc[keypart] !== "object")
          throw Error("can't modify field '" + keyparts[i + 1] +
                      "' of list value " + JSON.stringify(doc[keypart]));
      }
    } else {
      // XXX check valid fieldname (no $ at start, no .)
      if (!last && !(keypart in doc))
        doc[keypart] = {};
    }

    if (last)
      return doc;
    doc = doc[keypart];
  }

  // notreached
};

Collection._noCreateModifiers = {
  $unset: true,
  $pop: true,
  $rename: true,
  $pull: true,
  $pullAll: true
};

Collection._modifiers = {
  $inc: function (target, field, arg) {
    if (typeof arg !== "number")
      throw Error("Modifier $inc allowed for numbers only");
    if (field in target) {
      if (typeof target[field] !== "number")
        throw Error("Cannot apply $inc modifier to non-number");
      target[field] += arg;
    } else {
      target[field] = arg;
    }
  },
  $set: function (target, field, arg) {
    target[field] = Collection._deepcopy(arg);
  },
  $unset: function (target, field, arg) {
    if (target !== undefined) {
      if (target instanceof Array) {
        if (field in target)
          target[field] = null;
      } else
        delete target[field];
    }
  },
  $push: function (target, field, arg) {
    var x = target[field];
    if (x === undefined)
      target[field] = [arg];
    else if (!(x instanceof Array))
      throw Error("Cannot apply $push modifier to non-array");
    else
      x.push(Collection._deepcopy(arg));
  },
  $pushAll: function (target, field, arg) {
    if (!(typeof arg === "object" && arg instanceof Array))
      throw Error("Modifier $pushAll/pullAll allowed for arrays only");
    var x = target[field];
    if (x === undefined)
      target[field] = arg;
    else if (!(x instanceof Array))
      throw Error("Cannot apply $pushAll modifier to non-array");
    else {
      for (var i = 0; i < arg.length; i++)
        x.push(arg[i]);
    }
  },
  $addToSet: function (target, field, arg) {
    var x = target[field];
    if (x === undefined)
      target[field] = [arg];
    else if (!(x instanceof Array))
      throw Error("Cannot apply $addToSet modifier to non-array");
    else {
      var isEach = false;
      if (typeof arg === "object") {
        for (var k in arg) {
          if (k === "$each")
            isEach = true;
          break;
        }
      }
      var values = isEach ? arg["$each"] : [arg];
      _.each(values, function (value) {
        for (var i = 0; i < x.length; i++)
          if (Collection._f._equal(value, x[i]))
            return;
        x.push(value);
      });
    }
  },
  $pop: function (target, field, arg) {
    if (target === undefined)
      return;
    var x = target[field];
    if (x === undefined)
      return;
    else if (!(x instanceof Array))
      throw Error("Cannot apply $pop modifier to non-array");
    else {
      if (typeof arg === 'number' && arg < 0)
        x.splice(0, 1);
      else
        x.pop();
    }
  },
  $pull: function (target, field, arg) {
    if (target === undefined)
      return;
    var x = target[field];
    if (x === undefined)
      return;
    else if (!(x instanceof Array))
      throw Error("Cannot apply $pull/pullAll modifier to non-array");
    else {
      var out = []
      if (typeof arg === "object" && !(arg instanceof Array)) {
        // XXX would be much nicer to compile this once, rather than
        // for each document we modify.. but usually we're not
        // modifying that many documents, so we'll let it slide for
        // now

        // XXX _compileSelector isn't up for the job, because we need
        // to permit stuff like {$pull: {a: {$gt: 4}}}.. something
        // like {$gt: 4} is not normally a complete selector.
        // same issue as $elemMatch possibly?
        var match = Collection._compileSelector(arg);
        for (var i = 0; i < x.length; i++)
          if (!match(x[i]))
            out.push(x[i])
      } else {
        for (var i = 0; i < x.length; i++)
          if (!Collection._f._equal(x[i], arg))
            out.push(x[i]);
      }
      target[field] = out;
    }
  },
  $pullAll: function (target, field, arg) {
    if (!(typeof arg === "object" && arg instanceof Array))
      throw Error("Modifier $pushAll/pullAll allowed for arrays only");
    if (target === undefined)
      return;
    var x = target[field];
    if (x === undefined)
      return;
    else if (!(x instanceof Array))
      throw Error("Cannot apply $pull/pullAll modifier to non-array");
    else {
      var out = []
      for (var i = 0; i < x.length; i++) {
        var exclude = false;
        for (var j = 0; j < arg.length; j++) {
          if (Collection._f._equal(x[i], arg[j])) {
            exclude = true;
            break;
          }
        }
        if (!exclude)
          out.push(x[i]);
      }
      target[field] = out;
    }
  },
  $rename: function (target, field, arg, keypath, doc) {
    if (keypath === arg)
      // no idea why mongo has this restriction..
      throw Error("$rename source must differ from target");
    if (target === null)
      throw Error("$rename source field invalid");
    if (typeof arg !== "string")
      throw Error("$rename target must be a string");
    if (target === undefined)
      return;
    var v = target[field];
    delete target[field];

    var keyparts = arg.split('.');
    var target2 = Collection._findModTarget(doc, keyparts, false, true);
    if (target2 === null)
      throw Error("$rename target field invalid");
    var field2 = keyparts.pop();
    target2[field2] = v;
  },
  $bit: function (target, field, arg) {
    // XXX mongo only supports $bit on integers, and we only support
    // native javascript numbers (doubles) so far, so we can't support $bit
    throw Error("$bit is not supported");
  }
};

// helpers used by compiled selector code
Collection._f = {
  // XXX for _all and _in, consider building 'inquery' at compile time..

  _all: function (x, qval) {
    // XXX should use a canonicalizing representation, so that we
    // don't get screwed by key order
    var parts = {};
    var remaining = 0;
    _.each(qval, function (q) {
      var hash = JSON.stringify(q);
      if (!(hash in parts)) {
        parts[hash] = true;
        remaining++;
      }
    });

    for (var i = 0; i < x.length; i++) {
      var hash = JSON.stringify(x[i]);
      if (parts[hash]) {
        delete parts[hash];
        remaining--;
        if (0 === remaining)
          return true;
      }
    }

    return false;
  },

  _in: function (x, qval) {
    if (typeof x !== "object") {
      // optimization: use scalar equality (fast)
      for (var i = 0; i < qval.length; i++)
        if (x === qval[i])
          return true;
      return false;
    } else {
      // nope, have to use deep equality
      for (var i = 0; i < qval.length; i++)
        if (Collection._f._equal(x, qval[i]))
          return true;
      return false;
    }
  },

  _type: function (v) {
    if (typeof v === "number")
      return 1;
    if (typeof v === "string")
      return 2;
    if (typeof v === "boolean")
      return 8;
    if (v instanceof Array)
      return 4;
    if (v === null)
      return 10;
    if (v instanceof RegExp)
      return 11;
    if (typeof v === "function")
      // note that typeof(/x/) === "function"
      return 13;
    return 3; // object

    // XXX support some/all of these:
    // 5, binary data
    // 7, object id
    // 9, date
    // 14, symbol
    // 15, javascript code with scope
    // 16, 18: 32-bit/64-bit integer
    // 17, timestamp
    // 255, minkey
    // 127, maxkey
  },

  // deep equality test: use for literal document and array matches
  _equal: function (x, qval) {
    var match = function (a, b) {
      // scalars
      if (typeof a === 'number' || typeof a === 'string' ||
          typeof a === 'boolean' || a === undefined || a === null)
        return a === b;
      if (typeof a === 'function')
        return false;

      // OK, typeof a === 'object'
      if (typeof b !== 'object')
        return false;

      // arrays
      if (a instanceof Array) {
        if (!(b instanceof Array))
          return false;
        if (a.length !== b.length)
          return false;
        for (var i = 0; i < a.length; i++)
          if (!match(a[i],b[i]))
            return false;
        return true;
      }

      // objects
/*
      var unmatched_b_keys = 0;
      for (var x in b)
        unmatched_b_keys++;
      for (var x in a) {
        if (!(x in b) || !match(a[x], b[x]))
          return false;
        unmatched_b_keys--;
      }
      return unmatched_b_keys === 0;
*/
      // Follow Mongo in considering key order to be part of
      // equality. Key enumeration order is actually not defined in
      // the ecmascript spec but in practice most implementations
      // preserve it. (The exception is Chrome, which preserves it
      // usually, but not for keys that parse as ints.)
      var b_keys = [];
      for (var x in b)
        b_keys.push(b[x]);
      var i = 0;
      for (var x in a) {
        if (i >= b_keys.length)
          return false;
        if (!match(a[x], b_keys[i]))
          return false;
        i++;
      }
      if (i !== b_keys.length)
        return false;
      return true;
    };
    return match(x, qval);
  },

  // if x is not an array, true iff f(x) is true. if x is an array,
  // true iff f(y) is true for any y in x.
  //
  // this is the way most mongo operators (like $gt, $mod, $type..)
  // treat their arguments.
  _matches: function (x, f) {
    if (x instanceof Array) {
      for (var i = 0; i < x.length; i++)
        if (f(x[i]))
          return true;
      return false;
    }
    return f(x);
  },

  // like _matches, but if x is an array, it's true not only if f(y)
  // is true for some y in x, but also if f(x) is true.
  //
  // this is the way mongo value comparisons usually work, like {x:
  // 4}, {x: [4]}, or {x: {$in: [1,2,3]}}.
  _matches_plus: function (x, f) {
    if (x instanceof Array) {
      for (var i = 0; i < x.length; i++)
        if (f(x[i]))
          return true;
      // fall through!
    }
    return f(x);
  },

  // maps a type code to a value that can be used to sort values of
  // different types
  _typeorder: function (t) {
    // http://www.mongodb.org/display/DOCS/What+is+the+Compare+Order+for+BSON+Types
    // XXX what is the correct sort position for Javascript code?
    // ('100' in the matrix below)
    // XXX minkey/maxkey
    return [-1, 1, 2, 3, 4, 5, -1, 6, 7, 8, 0, 9, -1, 100, 2, 100, 1,
            8, 1][t];
  },

  // compare two values of unknown type according to BSON ordering
  // semantics. (as an extension, consider 'undefined' to be less than
  // any other value.) return negative if a is less, positive if b is
  // less, or 0 if equal
  _cmp: function (a, b) {
    if (a === undefined)
      return b === undefined ? 0 : -1;
    if (b === undefined)
      return 1;
    var ta = Collection._f._type(a);
    var tb = Collection._f._type(b);
    var oa = Collection._f._typeorder(ta);
    var ob = Collection._f._typeorder(tb);
    if (oa !== ob)
      return oa < ob ? -1 : 1;
    if (ta !== tb)
      // XXX need to implement this once we implement Symbol or
      // integers, or once we implement both Date and Timestamp
      throw Error("Missing type coercion logic in _cmp");
    if (ta === 1) // double
      return a - b;
    if (tb === 2) // string
      return a < b ? -1 : (a === b ? 0 : 1);
    if (ta === 3) { // Object
      // this could be much more efficient in the expected case ...
      var to_array = function (obj) {
        var ret = [];
        for (var key in obj) {
          ret.push(key);
          ret.push(obj[key]);
        }
        return ret;
      }
      return Collection._f._cmp(to_array(a), to_array(b));
    }
    if (ta === 4) { // Array
      for (var i = 0; ; i++) {
        if (i === a.length)
          return (i === b.length) ? 0 : -1;
        if (i === b.length)
          return 1;
        var s = Collection._f._cmp(a[i], b[i]);
        if (s !== 0)
          return s;
      }
    }
    // 5: binary data
    // 7: object id
    if (ta === 8) { // boolean
      if (a) return b ? 0 : 1;
      return b ? -1 : 0;
    }
    // 9: date
    if (ta === 10) // null
      return 0;
    if (ta === 11) // regexp
      throw Error("Sorting not supported on regular expression"); // XXX
    // 13: javascript code
    // 14: symbol
    // 15: javascript code with scope
    // 16: 32-bit integer
    // 17: timestamp
    // 18: 64-bit integer
    // 255: minkey
    // 127: maxkey
    if (ta === 13) // javascript code
      throw Error("Sorting not supported on Javascript code"); // XXX
  }
};

// For unit tests. True if the given document matches the given
// selector.
Collection._matches = function (selector, doc) {
  return (Collection._compileSelector(selector))(doc);
};

// Given a selector, return a function that takes one argument, a
// document, and returns true if the document matches the selector,
// else false.
Collection._compileSelector = function (selector) {
  var literals = [];
  // you can pass a literal function instead of a selector
  if (selector instanceof Function)
    return function (doc) {return selector.call(doc);};

  // shorthand -- scalars match _id
  if ((typeof selector === "string") || (typeof selector === "number"))
    selector = {_id: selector};

  // protect against dangerous selectors.  falsey and {_id: falsey}
  // are both likely programmer error, and not what you want,
  // particularly for destructive operations.
  if (!selector || (('_id' in selector) && !selector._id))
    return function (doc) {return false;};

  // eval() does not return a value in IE8, nor does the spec say it
  // should. Assign to a local to get the value, instead.
  var _func;
  eval("_func = (function(f,literals){return function(doc){return " +
       Collection._exprForSelector(selector, literals) +
       ";};})");
  return _func(Collection._f, literals);
};

// XXX implement ordinal indexing: 'people.2.name'

// Given an arbitrary Mongo-style query selector, return an expression
// that evaluates to true if the document in 'doc' matches the
// selector, else false.
Collection._exprForSelector = function (selector, literals) {
  var clauses = [];
  for (var key in selector) {
    var value = selector[key];

    if (key.substr(0, 1) === '$') { // no indexing into strings on IE7
      // whole-document predicate like {$or: [{x: 12}, {y: 12}]}
      clauses.push(Collection._exprForDocumentPredicate(key, value, literals));
    } else {
      // else, it's a constraint on a particular key (or dotted keypath)
      clauses.push(Collection._exprForKeypathPredicate(key, value, literals));
    }
  };

  if (clauses.length === 0) return 'true'; // selector === {}
  return '(' + clauses.join('&&') +')';
};

// 'op' is a top-level, whole-document predicate from a mongo
// selector, like '$or' in {$or: [{x: 12}, {y: 12}]}. 'value' is its
// value in the selector. Return an expression that evaluates to true
// if 'doc' matches this predicate, else false.
Collection._exprForDocumentPredicate = function (op, value, literals) {
  if (op === '$or') {
    var clauses = [];
    _.each(value, function (c) {
      clauses.push(Collection._exprForSelector(c, literals));
    });
    if (clauses.length === 0) return 'true';
    return '(' + clauses.join('||') +')';
  }

  if (op === '$and') {
    var clauses = [];
    _.each(value, function (c) {
      clauses.push(Collection._exprForSelector(c, literals));
    });
    if (clauses.length === 0) return 'true';
    return '(' + clauses.join('&&') +')';
  }

  if (op === '$nor') {
    var clauses = [];
    _.each(value, function (c) {
      clauses.push("!(" + Collection._exprForSelector(c, literals) + ")");
    });
    if (clauses.length === 0) return 'true';
    return '(' + clauses.join('&&') +')';
  }

  if (op === '$where') {
    if (value instanceof Function) {
      literals.push(value);
      return 'literals[' + (literals.length - 1) + '].call(doc)';
    }
    return "(function(){return " + value + ";}).call(doc)";
  }

  throw Error("Unrecogized key in selector: ", op);
}

// Given a single 'dotted.key.path: value' constraint from a Mongo
// query selector, return an expression that evaluates to true if the
// document in 'doc' matches the constraint, else false.
Collection._exprForKeypathPredicate = function (keypath, value, literals) {
  var keyparts = keypath.split('.');

  // get the inner predicate expression
  var predcode = '';
  if (value instanceof RegExp) {
    predcode = Collection._exprForOperatorTest(value, literals);
  } else if ( !(typeof value === 'object')
              || value === null
              || value instanceof Array) {
    // it's something like {x.y: 12} or {x.y: [12]}
    predcode = Collection._exprForValueTest(value, literals);
  } else {
    // is it a literal document or a bunch of $-expressions?
    var is_literal = true;
    for (var k in value) {
      if (k.substr(0, 1) === '$') { // no indexing into strings on IE7
        is_literal = false;
        break;
      }
    }

    if (is_literal) {
      // it's a literal document, like {x.y: {a: 12}}
      predcode = Collection._exprForValueTest(value, literals);
    } else {
      predcode = Collection._exprForOperatorTest(value, literals);
    }
  }

  // now, deal with the orthogonal concern of dotted.key.paths and the
  // (potentially multi-level) array searching they require
  var ret = '';
  var innermost = true;
  while (keyparts.length) {
    var part = keyparts.pop();
    var formal = keyparts.length ? "x" : "doc";
    if (innermost) {
      ret = '(function(x){return ' + predcode + ';})(' + formal + '[' +
        JSON.stringify(part) + '])';
      innermost = false;
    } else {
      // for all but the innermost level of a dotted expression,
      // if the runtime type is an array, search it
      ret = 'f._matches(' + formal + '[' + JSON.stringify(part) +
        '], function(x){return ' + ret + ';})';
    }
  }

  return ret;
};

// Given a value, return an expression that evaluates to true if the
// value in 'x' matches the value, or else false. This includes
// searching 'x' if it is an array. This doesn't include regular
// expressions (that's because mongo's $not operator works with
// regular expressions but not other kinds of scalar tests.)
Collection._exprForValueTest = function (value, literals) {
  var expr;

  if (value === null) {
    // null has special semantics
    // http://www.mongodb.org/display/DOCS/Querying+and+nulls
    expr = 'x===null||x===undefined';
  } else if (typeof value === 'string' ||
             typeof value === 'number' ||
             typeof value === 'boolean') {
    // literal scalar value
    // XXX object ids, dates, timestamps?
    expr = 'x===' + JSON.stringify(value);
  } else if (typeof value === 'function') {
    // note that typeof(/a/) === 'function' in javascript
    // XXX improve error
    throw Error("Bad value type in query");
  } else {
    // array or literal document
    expr = 'f._equal(x,' + JSON.stringify(value) + ')';
  }

  return 'f._matches_plus(x,function(x){return ' + expr + ';})';
};

// In a selector like {x: {$gt: 4, $lt: 8}}, we're calling the {$gt:
// 4, $lt: 8} part an "operator." Given an operator, return an
// expression that evaluates to true if the value in 'x' matches the
// operator, or else false. This includes searching 'x' if necessary
// if it's an array. In {x: /a/}, we consider /a/ to be an operator.
Collection._exprForOperatorTest = function (op, literals) {
  if (op instanceof RegExp) {
    return Collection._exprForOperatorTest({$regex: op}, literals);
  } else {
    var clauses = [];
    for (var type in op)
      clauses.push(Collection._exprForConstraint(type, op[type],
                                                      op, literals));
    if (clauses.length === 0)
      return 'true';
    return '(' + clauses.join('&&') + ')';
  }
};

// In an operator like {$gt: 4, $lt: 8}, we call each key/value pair,
// such as $gt: 4, a constraint. Given a constraint and its arguments,
// return an expression that evaluates to true if the value in 'x'
// matches the constraint, or else false. This includes searching 'x'
// if it's an array (and it's appropriate to the constraint.)
Collection._exprForConstraint = function (type, arg, others,
                                               literals) {
  var expr;
  var search = '_matches';
  var negate = false;

  if (type === '$gt') {
    expr = 'f._cmp(x,' + JSON.stringify(arg) + ')>0';
  } else if (type === '$lt') {
    expr = 'f._cmp(x,' + JSON.stringify(arg) + ')<0';
  } else if (type === '$gte') {
    expr = 'f._cmp(x,' + JSON.stringify(arg) + ')>=0';
  } else if (type === '$lte') {
    expr = 'f._cmp(x,' + JSON.stringify(arg) + ')<=0';
  } else if (type === '$all') {
    expr = 'f._all(x,' + JSON.stringify(arg) + ')';
    search = null;
  } else if (type === '$exists') {
    if (arg)
      expr = 'x!==undefined';
    else
      expr = 'x===undefined';
    search = null;
  } else if (type === '$mod') {
    expr = 'x%' + JSON.stringify(arg[0]) + '===' +
      JSON.stringify(arg[1]);
  } else if (type === '$ne') {
    if (typeof arg !== "object")
      expr = 'x===' + JSON.stringify(arg);
    else
      expr = 'f._equal(x,' + JSON.stringify(arg) + ')';
    search = '_matches_plus';
    negate = true; // tricky
  } else if (type === '$in') {
    expr = 'f._in(x,' + JSON.stringify(arg) + ')';
    search = '_matches_plus';
  } else if (type === '$nin') {
    expr = 'f._in(x,' + JSON.stringify(arg) + ')';
    search = '_matches_plus';
    negate = true;
  } else if (type === '$size') {
    expr = '(x instanceof Array)&&x.length===' + arg;
    search = null;
  } else if (type === '$type') {
    // $type: 1 is true for an array if any element in the array is of
    // type 1. but an array doesn't have type array unless it contains
    // an array..
    expr = 'f._type(x)===' + JSON.stringify(arg);
  } else if (type === '$regex') {
    // XXX mongo uses PCRE and supports some additional flags: 'x' and
    // 's'. javascript doesn't support them. so this is a divergence
    // between our behavior and mongo's behavior. ideally we would
    // implement x and s by transforming the regexp, but not today..
    if ('$options' in others && /[^gim]/.test(others['$options']))
      throw Error("Only the i, m, and g regexp options are supported");
    expr = 'literals[' + literals.length + '].test(x)';
    if (arg instanceof RegExp) {
      if ('$options' in others) {
        literals.push(new RegExp(arg.source, others['$options']));
      } else {
        literals.push(arg);
      }
    } else {
      literals.push(new RegExp(arg, others['$options']));
    }
  } else if (type === '$options') {
    expr = 'true';
    search = null;
  } else if (type === '$elemMatch') {
    // XXX implement
    throw Error("$elemMatch unimplemented");
  } else if (type === '$not') {
    // mongo doesn't support $regex inside a $not for some reason. we
    // do, because there's no reason not to that I can see.. but maybe
    // we should follow mongo's behavior?
    expr = '!' + Collection._exprForOperatorTest(arg, literals);
    search = null;
  } else {
    throw Error("Unrecognized key in selector: " + type);
  }

  if (search) {
    expr = 'f.' + search + '(x,function(x){return ' +
      expr + ';})';
  }

  if (negate)
    expr = '!' + expr;

  return expr;
};

// Give a sort spec, which can be in any of these forms:
//   {"key1": 1, "key2": -1}
//   [["key1", "asc"], ["key2", "desc"]]
//   ["key1", ["key2", "desc"]]
//
// (.. with the first form being dependent on the key enumeration
// behavior of your javascript VM, which usually does what you mean in
// this case if the key names don't look like integers ..)
//
// return a function that takes two objects, and returns -1 if the
// first object comes first in order, 1 if the second object comes
// first, or 0 if neither object comes before the other.

// XXX sort does not yet support subkeys ('a.b') .. fix that!

Collection._compileSort = function (spec) {
  var keys = [];
  var asc = [];

  if (spec instanceof Array) {
    for (var i = 0; i < spec.length; i++) {
      if (typeof spec[i] === "string") {
        keys.push(spec[i]);
        asc.push(true);
      } else {
        keys.push(spec[i][0]);
        asc.push(spec[i][1] !== "desc");
      }
    }
  } else if (typeof spec === "object") {
    for (key in spec) {
      keys.push(key);
      asc.push(!(spec[key] < 0));
    }
  } else {
    throw Error("Bad sort specification: ", JSON.stringify(spec));
  }

  if (keys.length === 0)
    return function () {return 0;};

  // eval() does not return a value in IE8, nor does the spec say it
  // should. Assign to a local to get the value, instead.
  var _func;
  var code = "_func = (function(c){return function(a,b){var x;";
  for (var i = 0; i < keys.length; i++) {
    if (i !== 0)
      code += "if(x!==0)return x;";
    code += "x=" + (asc[i] ? "" : "-") +
      "c(a[" + JSON.stringify(keys[i]) + "],b[" +
      JSON.stringify(keys[i]) + "]);";
  }
  code += "return x;};})";

  eval(code);
  return _func(Collection._f._cmp);
};

var MACHINE_ID = parseInt(Math.random() * 0xFFFFFF, 10),
PID = typeof process != 'undefined' ? process.pid : parseInt(Math.random() * 0xFFFFFF, 8);
inc = 0;

/**
 * generates a random, valid 24 character mongodb uid.
 */

var ObjectId = function() {
  var unixTime  = parseInt(Date.now()/1000, 10),
  time4Bytes    = BinaryParser.encodeInt(unixTime, 32, true, true),
  machine3Bytes = BinaryParser.encodeInt(MACHINE_ID, 24, false),
  pid2Bytes     = BinaryParser.fromShort(PID),
  index3Bytes   = BinaryParser.encodeInt(inc++, 24, false, true);

  return toHexString(time4Bytes + machine3Bytes + pid2Bytes + index3Bytes);
}

exports.ObjectId = ObjectId;

function toHexString(id) {
  var hexString = '', number, value;
  for (var index = 0, len = id.length; index < len; index++){
    value = BinaryParser.toByte(id.substr(index, 1));
    number = value <= 15 ? '0' + value.toString(16) : value.toString(16);
      hexString = hexString + number;
  }
  return hexString;
}
BinaryParser.Buffer = BinaryParserBuffer;

/**
 * Binary Parser.
 * Jonas Raoni Soares Silva
 * http://jsfromhell.com/classes/binary-parser [v1.0]
 */

var chr = String.fromCharCode;

var maxBits = [];
for (var i = 0; i < 64; i++) {
  maxBits[i] = Math.pow(2, i);
}

function BinaryParser (bigEndian, allowExceptions) {
  this.bigEndian = bigEndian;
  this.allowExceptions = allowExceptions;
};

BinaryParser.warn = function warn (msg) {
  if (this.allowExceptions) {
    throw new Error(msg);
  }

  return 1;
};

BinaryParser.decodeFloat = function decodeFloat (data, precisionBits, exponentBits) {
  var b = new this.Buffer(this.bigEndian, data);

  b.checkBuffer(precisionBits + exponentBits + 1);

  var bias = maxBits[exponentBits - 1] - 1
    , signal = b.readBits(precisionBits + exponentBits, 1)
    , exponent = b.readBits(precisionBits, exponentBits)
    , significand = 0
    , divisor = 2
    , curByte = b.buffer.length + (-precisionBits >> 3) - 1;

  do {
    for (var byteValue = b.buffer[ ++curByte ], startBit = precisionBits % 8 || 8, mask = 1 << startBit; mask >>= 1; ( byteValue & mask ) && ( significand += 1 / divisor ), divisor *= 2 );
  } while (precisionBits -= startBit);

  return exponent == ( bias << 1 ) + 1 ? significand ? NaN : signal ? -Infinity : +Infinity : ( 1 + signal * -2 ) * ( exponent || significand ? !exponent ? Math.pow( 2, -bias + 1 ) * significand : Math.pow( 2, exponent - bias ) * ( 1 + significand ) : 0 );
};

BinaryParser.decodeInt = function decodeInt (data, bits, signed, forceBigEndian) {
  var b = new this.Buffer(this.bigEndian || forceBigEndian, data)
      , x = b.readBits(0, bits)
      , max = maxBits[bits]; //max = Math.pow( 2, bits );

  return signed && x >= max / 2
      ? x - max
      : x;
};

BinaryParser.encodeFloat = function encodeFloat (data, precisionBits, exponentBits) {
  var bias = maxBits[exponentBits - 1] - 1
    , minExp = -bias + 1
    , maxExp = bias
    , minUnnormExp = minExp - precisionBits
    , n = parseFloat(data)
    , status = isNaN(n) || n == -Infinity || n == +Infinity ? n : 0
    , exp = 0
    , len = 2 * bias + 1 + precisionBits + 3
    , bin = new Array(len)
    , signal = (n = status !== 0 ? 0 : n) < 0
    , intPart = Math.floor(n = Math.abs(n))
    , floatPart = n - intPart
    , lastBit
    , rounded
    , result
    , i
    , j;

  for (i = len; i; bin[--i] = 0);

  for (i = bias + 2; intPart && i; bin[--i] = intPart % 2, intPart = Math.floor(intPart / 2));

  for (i = bias + 1; floatPart > 0 && i; (bin[++i] = ((floatPart *= 2) >= 1) - 0 ) && --floatPart);

  for (i = -1; ++i < len && !bin[i];);

  if (bin[(lastBit = precisionBits - 1 + (i = (exp = bias + 1 - i) >= minExp && exp <= maxExp ? i + 1 : bias + 1 - (exp = minExp - 1))) + 1]) {
    if (!(rounded = bin[lastBit])) {
      for (j = lastBit + 2; !rounded && j < len; rounded = bin[j++]);
    }

    for (j = lastBit + 1; rounded && --j >= 0; (bin[j] = !bin[j] - 0) && (rounded = 0));
  }

  for (i = i - 2 < 0 ? -1 : i - 3; ++i < len && !bin[i];);

  if ((exp = bias + 1 - i) >= minExp && exp <= maxExp) {
    ++i;
  } else if (exp < minExp) {
    exp != bias + 1 - len && exp < minUnnormExp && this.warn("encodeFloat::float underflow");
    i = bias + 1 - (exp = minExp - 1);
  }

  if (intPart || status !== 0) {
    this.warn(intPart ? "encodeFloat::float overflow" : "encodeFloat::" + status);
    exp = maxExp + 1;
    i = bias + 2;

    if (status == -Infinity) {
      signal = 1;
    } else if (isNaN(status)) {
      bin[i] = 1;
    }
  }

  for (n = Math.abs(exp + bias), j = exponentBits + 1, result = ""; --j; result = (n % 2) + result, n = n >>= 1);

  for (n = 0, j = 0, i = (result = (signal ? "1" : "0") + result + bin.slice(i, i + precisionBits).join("")).length, r = []; i; j = (j + 1) % 8) {
    n += (1 << j) * result.charAt(--i);
    if (j == 7) {
      r[r.length] = String.fromCharCode(n);
      n = 0;
    }
  }

  r[r.length] = n
    ? String.fromCharCode(n)
    : "";

  return (this.bigEndian ? r.reverse() : r).join("");
};

BinaryParser.encodeInt = function encodeInt (data, bits, signed, forceBigEndian) {
  var max = maxBits[bits];

  if (data >= max || data < -(max / 2)) {
    this.warn("encodeInt::overflow");
    data = 0;
  }

  if (data < 0) {
    data += max;
  }

  for (var r = []; data; r[r.length] = String.fromCharCode(data % 256), data = Math.floor(data / 256));

  for (bits = -(-bits >> 3) - r.length; bits--; r[r.length] = "\0");

  return ((this.bigEndian || forceBigEndian) ? r.reverse() : r).join("");
};

BinaryParser.toSmall    = function( data ){ return this.decodeInt( data,  8, true  ); };
BinaryParser.fromSmall  = function( data ){ return this.encodeInt( data,  8, true  ); };
BinaryParser.toByte     = function( data ){ return this.decodeInt( data,  8, false ); };
BinaryParser.fromByte   = function( data ){ return this.encodeInt( data,  8, false ); };
BinaryParser.toShort    = function( data ){ return this.decodeInt( data, 16, true  ); };
BinaryParser.fromShort  = function( data ){ return this.encodeInt( data, 16, true  ); };
BinaryParser.toWord     = function( data ){ return this.decodeInt( data, 16, false ); };
BinaryParser.fromWord   = function( data ){ return this.encodeInt( data, 16, false ); };
BinaryParser.toInt      = function( data ){ return this.decodeInt( data, 32, true  ); };
BinaryParser.fromInt    = function( data ){ return this.encodeInt( data, 32, true  ); };
BinaryParser.toLong     = function( data ){ return this.decodeInt( data, 64, true  ); };
BinaryParser.fromLong   = function( data ){ return this.encodeInt( data, 64, true  ); };
BinaryParser.toDWord    = function( data ){ return this.decodeInt( data, 32, false ); };
BinaryParser.fromDWord  = function( data ){ return this.encodeInt( data, 32, false ); };
BinaryParser.toQWord    = function( data ){ return this.decodeInt( data, 64, true ); };
BinaryParser.fromQWord  = function( data ){ return this.encodeInt( data, 64, true ); };
BinaryParser.toFloat    = function( data ){ return this.decodeFloat( data, 23, 8   ); };
BinaryParser.fromFloat  = function( data ){ return this.encodeFloat( data, 23, 8   ); };
BinaryParser.toDouble   = function( data ){ return this.decodeFloat( data, 52, 11  ); };
BinaryParser.fromDouble = function( data ){ return this.encodeFloat( data, 52, 11  ); };

// Factor out the encode so it can be shared by add_header and push_int32
BinaryParser.encode_int32 = function encode_int32 (number) {
  var a, b, c, d, unsigned;
  unsigned = (number < 0) ? (number + 0x100000000) : number;
  a = Math.floor(unsigned / 0xffffff);
  unsigned &= 0xffffff;
  b = Math.floor(unsigned / 0xffff);
  unsigned &= 0xffff;
  c = Math.floor(unsigned / 0xff);
  unsigned &= 0xff;
  d = Math.floor(unsigned);
  return chr(a) + chr(b) + chr(c) + chr(d);
};

BinaryParser.encode_int64 = function encode_int64 (number) {
  var a, b, c, d, e, f, g, h, unsigned;
  unsigned = (number < 0) ? (number + 0x10000000000000000) : number;
  a = Math.floor(unsigned / 0xffffffffffffff);
  unsigned &= 0xffffffffffffff;
  b = Math.floor(unsigned / 0xffffffffffff);
  unsigned &= 0xffffffffffff;
  c = Math.floor(unsigned / 0xffffffffff);
  unsigned &= 0xffffffffff;
  d = Math.floor(unsigned / 0xffffffff);
  unsigned &= 0xffffffff;
  e = Math.floor(unsigned / 0xffffff);
  unsigned &= 0xffffff;
  f = Math.floor(unsigned / 0xffff);
  unsigned &= 0xffff;
  g = Math.floor(unsigned / 0xff);
  unsigned &= 0xff;
  h = Math.floor(unsigned);
  return chr(a) + chr(b) + chr(c) + chr(d) + chr(e) + chr(f) + chr(g) + chr(h);
};

/**
 * UTF8 methods
 */

// Take a raw binary string and return a utf8 string
BinaryParser.decode_utf8 = function decode_utf8 (binaryStr) {
  var len = binaryStr.length
    , decoded = ''
    , i = 0
    , c = 0
    , c1 = 0
    , c2 = 0
    , c3;

  while (i < len) {
    c = binaryStr.charCodeAt(i);
    if (c < 128) {
      decoded += String.fromCharCode(c);
      i++;
    } else if ((c > 191) && (c < 224)) {
      c2 = binaryStr.charCodeAt(i+1);
      decoded += String.fromCharCode(((c & 31) << 6) | (c2 & 63));
      i += 2;
    } else {
      c2 = binaryStr.charCodeAt(i+1);
      c3 = binaryStr.charCodeAt(i+2);
      decoded += String.fromCharCode(((c & 15) << 12) | ((c2 & 63) << 6) | (c3 & 63));
      i += 3;
    }
  }

  return decoded;
};

// Encode a cstring
BinaryParser.encode_cstring = function encode_cstring (s) {
  return unescape(encodeURIComponent(s)) + BinaryParser.fromByte(0);
};

// Take a utf8 string and return a binary string
BinaryParser.encode_utf8 = function encode_utf8 (s) {
  var a = ""
    , c;

  for (var n = 0, len = s.length; n < len; n++) {
    c = s.charCodeAt(n);

    if (c < 128) {
      a += String.fromCharCode(c);
    } else if ((c > 127) && (c < 2048)) {
      a += String.fromCharCode((c>>6) | 192) ;
      a += String.fromCharCode((c&63) | 128);
    } else {
      a += String.fromCharCode((c>>12) | 224);
      a += String.fromCharCode(((c>>6) & 63) | 128);
      a += String.fromCharCode((c&63) | 128);
    }
  }

  return a;
};

BinaryParser.hprint = function hprint (s) {
  var number;

  for (var i = 0, len = s.length; i < len; i++) {
    if (s.charCodeAt(i) < 32) {
      number = s.charCodeAt(i) <= 15
        ? "0" + s.charCodeAt(i).toString(16)
        : s.charCodeAt(i).toString(16);
      process.stdout.write(number + " ")
    } else {
      number = s.charCodeAt(i) <= 15
        ? "0" + s.charCodeAt(i).toString(16)
        : s.charCodeAt(i).toString(16);
        process.stdout.write(number + " ")
    }
  }

  process.stdout.write("\n\n");
};

BinaryParser.ilprint = function hprint (s) {
  var number;

  for (var i = 0, len = s.length; i < len; i++) {
    if (s.charCodeAt(i) < 32) {
      number = s.charCodeAt(i) <= 15
        ? "0" + s.charCodeAt(i).toString(10)
        : s.charCodeAt(i).toString(10);

    } else {
      number = s.charCodeAt(i) <= 15
        ? "0" + s.charCodeAt(i).toString(10)
        : s.charCodeAt(i).toString(10);

    }
  }
};

BinaryParser.hlprint = function hprint (s) {
  var number;

  for (var i = 0, len = s.length; i < len; i++) {
    if (s.charCodeAt(i) < 32) {
      number = s.charCodeAt(i) <= 15
        ? "0" + s.charCodeAt(i).toString(16)
        : s.charCodeAt(i).toString(16);

    } else {
      number = s.charCodeAt(i) <= 15
        ? "0" + s.charCodeAt(i).toString(16)
        : s.charCodeAt(i).toString(16);

    }
  }
};

/**
 * BinaryParser buffer constructor.
 */

function BinaryParserBuffer (bigEndian, buffer) {
  this.bigEndian = bigEndian || 0;
  this.buffer = [];
  this.setBuffer(buffer);
};

BinaryParserBuffer.prototype.setBuffer = function setBuffer (data) {
  var l, i, b;

  if (data) {
    i = l = data.length;
    b = this.buffer = new Array(l);
    for (; i; b[l - i] = data.charCodeAt(--i));
    this.bigEndian && b.reverse();
  }
};

BinaryParserBuffer.prototype.hasNeededBits = function hasNeededBits (neededBits) {
  return this.buffer.length >= -(-neededBits >> 3);
};

BinaryParserBuffer.prototype.checkBuffer = function checkBuffer (neededBits) {
  if (!this.hasNeededBits(neededBits)) {
    throw new Error("checkBuffer::missing bytes");
  }
};

BinaryParserBuffer.prototype.readBits = function readBits (start, length) {
  //shl fix: Henri Torgemane ~1996 (compressed by Jonas Raoni)

  function shl (a, b) {
    for (; b--; a = ((a %= 0x7fffffff + 1) & 0x40000000) == 0x40000000 ? a * 2 : (a - 0x40000000) * 2 + 0x7fffffff + 1);
    return a;
  }

  if (start < 0 || length <= 0) {
    return 0;
  }

  this.checkBuffer(start + length);

  var offsetLeft
    , offsetRight = start % 8
    , curByte = this.buffer.length - ( start >> 3 ) - 1
    , lastByte = this.buffer.length + ( -( start + length ) >> 3 )
    , diff = curByte - lastByte
    , sum = ((this.buffer[ curByte ] >> offsetRight) & ((1 << (diff ? 8 - offsetRight : length)) - 1)) + (diff && (offsetLeft = (start + length) % 8) ? (this.buffer[lastByte++] & ((1 << offsetLeft) - 1)) << (diff-- << 3) - offsetRight : 0);

  for(; diff; sum += shl(this.buffer[lastByte++], (diff-- << 3) - offsetRight));

  return sum;
};
 var _ = {};

// Save bytes in the minified (but not gzipped) version:
  var ArrayProto = Array.prototype, ObjProto = Object.prototype, FuncProto = Function.prototype;

  var push             = ArrayProto.push,
      slice            = ArrayProto.slice,
      unshift          = ArrayProto.unshift,
      toString         = ObjProto.toString,
      hasOwnProperty   = ObjProto.hasOwnProperty;

  // All **ECMAScript 5** native function implementations that we hope to use
  // are declared here.
  var
    nativeForEach      = ArrayProto.forEach,
    nativeMap          = ArrayProto.map,
    nativeReduce       = ArrayProto.reduce,
    nativeReduceRight  = ArrayProto.reduceRight,
    nativeFilter       = ArrayProto.filter,
    nativeEvery        = ArrayProto.every,
    nativeSome         = ArrayProto.some,
    nativeIndexOf      = ArrayProto.indexOf,
    nativeLastIndexOf  = ArrayProto.lastIndexOf,
    nativeIsArray      = Array.isArray,
    nativeKeys         = Object.keys,
    nativeBind         = FuncProto.bind;

// Is a given value a function?
_.isFunction = function(obj) {
  return toString.call(obj) == '[object Function]';
};

var each = _.each = _.forEach = function(obj, iterator, context) {
  if (obj == null) return;
  if (nativeForEach && obj.forEach === nativeForEach) {
    obj.forEach(iterator, context);
  } else if (obj.length === +obj.length) {
    for (var i = 0, l = obj.length; i < l; i++) {
      if (iterator.call(context, obj[i], i, obj) === breaker) return;
    }
  } else {
    for (var key in obj) {
      if (_.has(obj, key)) {
        if (iterator.call(context, obj[key], key, obj) === breaker) return;
      }
    }
  }
};

// Is a given value an array?
// Delegates to ECMA5's native Array.isArray
_.isArray = nativeIsArray || function(obj) {
  return toString.call(obj) == '[object Array]';
};

// Use a comparator function to figure out the smallest index at which
// an object should be inserted so as to maintain order. Uses binary search.
_.sortedIndex = function(array, obj, iterator) {
  iterator || (iterator = _.identity);
  var value = iterator(obj);
  var low = 0, high = array.length;
  while (low < high) {
    var mid = (low + high) >> 1;
    iterator(array[mid]) < value ? low = mid + 1 : high = mid;
  }
  return low;
  };

// Shortcut function for checking if an object has a given property directly
// on itself (in other words, not on a prototype).
_.has = function(obj, key) {
  return hasOwnProperty.call(obj, key);
};

// Internal recursive comparison function for `isEqual`.
function eq(a, b, stack) {
  // Identical objects are equal. `0 === -0`, but they aren't identical.
  // See the Harmony `egal` proposal: http://wiki.ecmascript.org/doku.php?id=harmony:egal.
  if (a === b) return a !== 0 || 1 / a == 1 / b;
  // A strict comparison is necessary because `null == undefined`.
  if (a == null || b == null) return a === b;
  // Unwrap any wrapped objects.
  if (a._chain) a = a._wrapped;
  if (b._chain) b = b._wrapped;
  // Invoke a custom `isEqual` method if one is provided.
  if (a.isEqual && _.isFunction(a.isEqual)) return a.isEqual(b);
  if (b.isEqual && _.isFunction(b.isEqual)) return b.isEqual(a);
  // Compare `[[Class]]` names.
  var className = toString.call(a);
  if (className != toString.call(b)) return false;
  switch (className) {
    // Strings, numbers, dates, and booleans are compared by value.
    case '[object String]':
      // Primitives and their corresponding object wrappers are equivalent; thus, `"5"` is
      // equivalent to `new String("5")`.
      return a == String(b);
    case '[object Number]':
      // `NaN`s are equivalent, but non-reflexive. An `egal` comparison is performed for
      // other numeric values.
      return a != +a ? b != +b : (a == 0 ? 1 / a == 1 / b : a == +b);
    case '[object Date]':
    case '[object Boolean]':
      // Coerce dates and booleans to numeric primitive values. Dates are compared by their
      // millisecond representations. Note that invalid dates with millisecond representations
      // of `NaN` are not equivalent.
      return +a == +b;
    // RegExps are compared by their source patterns and flags.
    case '[object RegExp]':
      return a.source == b.source &&
             a.global == b.global &&
             a.multiline == b.multiline &&
             a.ignoreCase == b.ignoreCase;
  }
  if (typeof a != 'object' || typeof b != 'object') return false;
  // Assume equality for cyclic structures. The algorithm for detecting cyclic
  // structures is adapted from ES 5.1 section 15.12.3, abstract operation `JO`.
  var length = stack.length;
  while (length--) {
    // Linear search. Performance is inversely proportional to the number of
    // unique nested structures.
    if (stack[length] == a) return true;
  }
  // Add the first object to the stack of traversed objects.
  stack.push(a);
  var size = 0, result = true;
  // Recursively compare objects and arrays.
  if (className == '[object Array]') {
    // Compare array lengths to determine if a deep comparison is necessary.
    size = a.length;
    result = size == b.length;
    if (result) {
      // Deep compare the contents, ignoring non-numeric properties.
      while (size--) {
        // Ensure commutative equality for sparse arrays.
        if (!(result = size in a == size in b && eq(a[size], b[size], stack))) break;
      }
    }
  } else {
    // Objects with different constructors are not equivalent.
    if ('constructor' in a != 'constructor' in b || a.constructor != b.constructor) return false;
    // Deep compare objects.
    for (var key in a) {
      if (_.has(a, key)) {
        // Count the expected number of properties.
        size++;
        // Deep compare each member.
        if (!(result = _.has(b, key) && eq(a[key], b[key], stack))) break;
      }
    }
    // Ensure that both objects contain the same number of properties.
    if (result) {
      for (key in b) {
        if (_.has(b, key) && !(size--)) break;
      }
      result = !size;
    }
  }
  // Remove the first object from the stack of traversed objects.
  stack.pop();
  return result;
}

// Perform a deep comparison to check if two objects are equal.
_.isEqual = function(a, b) {
  return eq(a, b, []);
};

// Create a function bound to a given object (assigning `this`, and arguments,
// optionally). Binding with arguments is also known as `curry`.
// Delegates to **ECMAScript 5**'s native `Function.bind` if available.
// We check for `func.bind` first, to fail fast when `func` is undefined.
_.bind = function bind(func, context) {
  var bound, args;
  if (func.bind === nativeBind && nativeBind) return nativeBind.apply(func, slice.call(arguments, 1));
  if (!_.isFunction(func)) throw new TypeError;
  args = slice.call(arguments, 2);
  return bound = function() {
    if (!(this instanceof bound)) return func.apply(context, args.concat(slice.call(arguments)));
    ctor.prototype = func.prototype;
    var self = new ctor;
    var result = func.apply(self, args.concat(slice.call(arguments)));
    if (Object(result) === result) return result;
    return self;
  };
};

// Keep the identity function around for default iterators.
_.identity = function(value) {
  return value;
};

// Extend a given object with all the properties in passed-in object(s).
_.extend = function(obj) {
  each(slice.call(arguments, 1), function(source) {
    for (var prop in source) {
      obj[prop] = source[prop];
    }
  });
  return obj;
};

// If the browser doesn't supply us with indexOf (I'm looking at you, **MSIE**),
// we need this function. Return the position of the first occurrence of an
// item in an array, or -1 if the item is not included in the array.
// Delegates to **ECMAScript 5**'s native `indexOf` if available.
// If the array is large and already in sort order, pass `true`
// for **isSorted** to use binary search.
_.indexOf = function(array, item, isSorted) {
  if (array == null) return -1;
  var i, l;
  if (isSorted) {
    i = _.sortedIndex(array, item);
    return array[i] === item ? i : -1;
  }
  if (nativeIndexOf && array.indexOf === nativeIndexOf) return array.indexOf(item);
  for (i = 0, l = array.length; i < l; i++) if (array[i] === item) return i;
  return -1;
};var isArray = Array.isArray;
var domain;

function EventEmitter() {}

exports.EventEmitter = EventEmitter;

// By default EventEmitters will print a warning if more than
// 10 listeners are added to it. This is a useful default which
// helps finding memory leaks.
//
// Obviously not all Emitters should be limited to 10. This function allows
// that to be increased. Set to zero for unlimited.
var defaultMaxListeners = 10;
EventEmitter.prototype.setMaxListeners = function(n) {
  if (!this._events) this._events = {};
  this._maxListeners = n;
};


EventEmitter.prototype.emit = function() {
  var type = arguments[0];
  // If there is no 'error' event listener then throw.
  if (type === 'error') {
    if (!this._events || !this._events.error ||
        (isArray(this._events.error) && !this._events.error.length))
    {

      if (arguments[1] instanceof Error) {
        throw arguments[1]; // Unhandled 'error' event
      } else {
        throw new Error("Uncaught, unspecified 'error' event.");
      }
      return false;
    }
  }

  if (!this._events) return false;
  var handler = this._events[type];
  if (!handler) return false;

  if (typeof handler == 'function') {
    switch (arguments.length) {
      // fast cases
      case 1:
        handler.call(this);
        break;
      case 2:
        handler.call(this, arguments[1]);
        break;
      case 3:
        handler.call(this, arguments[1], arguments[2]);
        break;
      // slower
      default:
        var l = arguments.length;
        var args = new Array(l - 1);
        for (var i = 1; i < l; i++) args[i - 1] = arguments[i];
        handler.apply(this, args);
    }
    return true;

  } else if (isArray(handler)) {
    var l = arguments.length;
    var args = new Array(l - 1);
    for (var i = 1; i < l; i++) args[i - 1] = arguments[i];

    var listeners = handler.slice();
    for (var i = 0, l = listeners.length; i < l; i++) {
      listeners[i].apply(this, args);
    }
    return true;

  } else {
    return false;
  }
};

EventEmitter.prototype.addListener = function(type, listener) {
  if ('function' !== typeof listener) {
    throw new Error('addListener only takes instances of Function');
  }

  if (!this._events) this._events = {};

  // To avoid recursion in the case that type == "newListeners"! Before
  // adding it to the listeners, first emit "newListeners".
  this.emit('newListener', type, typeof listener.listener === 'function' ?
            listener.listener : listener);

  if (!this._events[type]) {
    // Optimize the case of one listener. Don't need the extra array object.
    this._events[type] = listener;
  } else if (isArray(this._events[type])) {

    // If we've already got an array, just append.
    this._events[type].push(listener);

  } else {
    // Adding the second element, need to change to array.
    this._events[type] = [this._events[type], listener];

  }

  // Check for listener leak
  if (isArray(this._events[type]) && !this._events[type].warned) {
    var m;
    if (this._maxListeners !== undefined) {
      m = this._maxListeners;
    } else {
      m = defaultMaxListeners;
    }

    if (m && m > 0 && this._events[type].length > m) {
      this._events[type].warned = true;
      console.error('(node) warning: possible EventEmitter memory ' +
                    'leak detected. %d listeners added. ' +
                    'Use emitter.setMaxListeners() to increase limit.',
                    this._events[type].length);
      console.trace();
    }
  }

  return this;
};

EventEmitter.prototype.on = EventEmitter.prototype.addListener;

EventEmitter.prototype.once = function(type, listener) {
  if ('function' !== typeof listener) {
    throw new Error('.once only takes instances of Function');
  }

  var self = this;
  function g() {
    self.removeListener(type, g);
    listener.apply(this, arguments);
  };

  g.listener = listener;
  self.on(type, g);

  return this;
};

EventEmitter.prototype.removeListener = function(type, listener) {
  if ('function' !== typeof listener) {
    throw new Error('removeListener only takes instances of Function');
  }

  // does not use listeners(), so no side effect of creating _events[type]
  if (!this._events || !this._events[type]) return this;

  var list = this._events[type];

  if (isArray(list)) {
    var position = -1;
    for (var i = 0, length = list.length; i < length; i++) {
      if (list[i] === listener ||
          (list[i].listener && list[i].listener === listener))
      {
        position = i;
        break;
      }
    }

    if (position < 0) return this;
    list.splice(position, 1);
  } else if (list === listener ||
             (list.listener && list.listener === listener))
  {
    delete this._events[type];
  }

  return this;
};

EventEmitter.prototype.removeAllListeners = function(type) {
  if (arguments.length === 0) {
    this._events = {};
    return this;
  }

  // does not use listeners(), so no side effect of creating _events[type]
  if (type && this._events && this._events[type]) this._events[type] = null;
  return this;
};

EventEmitter.prototype.listeners = function(type) {
  if (!this._events) this._events = {};
  if (!this._events[type]) this._events[type] = [];
  if (!isArray(this._events[type])) {
    this._events[type] = [this._events[type]];
  }
  return this._events[type];
};