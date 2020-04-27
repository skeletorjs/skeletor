//     Backbone.js 1.4.0
//     (c) 2010-2019 Jeremy Ashkenas and DocumentCloud
//     Backbone may be freely distributed under the MIT license.

// Collection
// ----------

// If models tend to represent a single row of data, a Collection is
// more analogous to a table full of data ... or a small slice or page of that
// table, or a collection of rows that belong together for a particular reason
// -- all of the messages in this particular folder, all of the documents
// belonging to this particular author, and so on. Collections maintain
// indexes of their models, both in order, and for lookup by `id`.

import { addMethodsToObject, inherits, getResolveablePromise, getSyncMethod, urlError, wrapError } from './helpers.js';
import { Events } from './events.js';
import { Model } from './model.js';
import _ from 'lodash';

const slice = Array.prototype.slice;

// Create a new **Collection**, perhaps to contain a specific type of `model`.
// If a `comparator` is specified, the Collection will maintain
// its models in sort order, as they're added and removed.
export const Collection = function(models, options) {
  options || (options = {});
  this.preinitialize.apply(this, arguments);
  if (options.model) this.model = options.model;
  if (options.comparator !== undefined) this.comparator = options.comparator;
  this._reset();
  this.initialize.apply(this, arguments);
  if (models) this.reset(models, _.extend({silent: true}, options));
};

Collection.extend = inherits;


// Default options for `Collection#set`.
const setOptions = {add: true, remove: true, merge: true};
const addOptions = {add: true, remove: false};

// Splices `insert` into `array` at index `at`.
const splice = function(array, insert, at) {
  at = Math.min(Math.max(at, 0), array.length);
  const tail = Array(array.length - at);
  const length = insert.length;
  let i;
  for (i = 0; i < tail.length; i++) tail[i] = array[i + at];
  for (i = 0; i < length; i++) array[i + at] = insert[i];
  for (i = 0; i < tail.length; i++) array[i + length + at] = tail[i];
};

// Define the Collection's inheritable methods.
_.extend(Collection.prototype, Events, {

  // The default model for a collection is just a **Backbone.Model**.
  // This should be overridden in most cases.
  model: Model,


  // preinitialize is an empty function by default. You can override it with a function
  // or object.  preinitialize will run before any instantiation logic is run in the Collection.
  preinitialize: function(){},

  // Initialize is an empty function by default. Override it with your own
  // initialization logic.
  initialize: function(){},

  // The JSON representation of a Collection is an array of the
  // models' attributes.
  toJSON: function(options) {
    return this.map(function(model) { return model.toJSON(options); });
  },

  // Proxy `Backbone.sync` by default.
  sync: function(method, model, options) {
    return getSyncMethod(this)(method, model, options);
  },

  // Add a model, or list of models to the set. `models` may be Backbone
  // Models or raw JavaScript objects to be converted to Models, or any
  // combination of the two.
  add: function(models, options) {
    return this.set(models, _.extend({merge: false}, options, addOptions));
  },

  // Remove a model, or a list of models from the set.
  remove: function(models, options) {
    options = _.extend({}, options);
    const singular = !_.isArray(models);
    models = singular ? [models] : models.slice();
    const removed = this._removeModels(models, options);
    if (!options.silent && removed.length) {
      options.changes = {added: [], merged: [], removed: removed};
      this.trigger('update', this, options);
    }
    return singular ? removed[0] : removed;
  },

  // Update a collection by `set`-ing a new list of models, adding new ones,
  // removing models that are no longer present, and merging models that
  // already exist in the collection, as necessary. Similar to **Model#set**,
  // the core operation for updating the data contained by the collection.
  set: function(models, options) {
    if (models == null) return;

    options = _.extend({}, setOptions, options);
    if (options.parse && !this._isModel(models)) {
      models = this.parse(models, options) || [];
    }

    const singular = !_.isArray(models);
    models = singular ? [models] : models.slice();

    let at = options.at;
    if (at != null) at = +at;
    if (at > this.length) at = this.length;
    if (at < 0) at += this.length + 1;

    const set = [];
    const toAdd = [];
    const toMerge = [];
    const toRemove = [];
    const modelMap = {};

    const add = options.add;
    const merge = options.merge;
    const remove = options.remove;

    let sort = false;
    const sortable = this.comparator && at == null && options.sort !== false;
    const sortAttr = _.isString(this.comparator) ? this.comparator : null;

    // Turn bare objects into model references, and prevent invalid models
    // from being added.
    let model, i;
    for (i = 0; i < models.length; i++) {
      model = models[i];

      // If a duplicate is found, prevent it from being added and
      // optionally merge it into the existing model.
      const existing = this.get(model);
      if (existing) {
        if (merge && model !== existing) {
          let attrs = this._isModel(model) ? model.attributes : model;
          if (options.parse) attrs = existing.parse(attrs, options);
          existing.set(attrs, options);
          toMerge.push(existing);
          if (sortable && !sort) sort = existing.hasChanged(sortAttr);
        }
        if (!modelMap[existing.cid]) {
          modelMap[existing.cid] = true;
          set.push(existing);
        }
        models[i] = existing;

      // If this is a new, valid model, push it to the `toAdd` list.
      } else if (add) {
        model = models[i] = this._prepareModel(model, options);
        if (model) {
          toAdd.push(model);
          this._addReference(model, options);
          modelMap[model.cid] = true;
          set.push(model);
        }
      }
    }

    // Remove stale models.
    if (remove) {
      for (i = 0; i < this.length; i++) {
        model = this.models[i];
        if (!modelMap[model.cid]) toRemove.push(model);
      }
      if (toRemove.length) this._removeModels(toRemove, options);
    }

    // See if sorting is needed, update `length` and splice in new models.
    let orderChanged = false;
    const replace = !sortable && add && remove;
    if (set.length && replace) {
      orderChanged = this.length !== set.length || _.some(this.models, function(m, index) {
        return m !== set[index];
      });
      this.models.length = 0;
      splice(this.models, set, 0);
      this.length = this.models.length;
    } else if (toAdd.length) {
      if (sortable) sort = true;
      splice(this.models, toAdd, at == null ? this.length : at);
      this.length = this.models.length;
    }

    // Silently sort the collection if appropriate.
    if (sort) this.sort({silent: true});

    // Unless silenced, it's time to fire all appropriate add/sort/update events.
    if (!options.silent) {
      for (i = 0; i < toAdd.length; i++) {
        if (at != null) options.index = at + i;
        model = toAdd[i];
        model.trigger('add', model, this, options);
      }
      if (sort || orderChanged) this.trigger('sort', this, options);
      if (toAdd.length || toRemove.length || toMerge.length) {
        options.changes = {
          added: toAdd,
          removed: toRemove,
          merged: toMerge
        };
        this.trigger('update', this, options);
      }
    }

    // Return the added (or merged) model (or models).
    return singular ? models[0] : models;
  },

  clearStore: async function(options={}) {
      await Promise.all(Array.from(this.models).map(m => {
          return new Promise(
              resolve => {
                  m.destroy(Object.assign(options, {
                      'success': resolve,
                      'error': (m, e) => { console.error(e); resolve() }
                  }));
              }
          );
      }));
      await this.browserStorage.clear();
      this.reset();
  },

  // When you have more items than you want to add or remove individually,
  // you can reset the entire set with a new list of models, without firing
  // any granular `add` or `remove` events. Fires `reset` when finished.
  // Useful for bulk operations and optimizations.
  reset: function(models, options) {
    options = options ? _.clone(options) : {};
    for (let i = 0; i < this.models.length; i++) {
      this._removeReference(this.models[i], options);
    }
    options.previousModels = this.models;
    this._reset();
    models = this.add(models, _.extend({silent: true}, options));
    if (!options.silent) this.trigger('reset', this, options);
    return models;
  },

  // Add a model to the end of the collection.
  push: function(model, options) {
    return this.add(model, _.extend({at: this.length}, options));
  },

  // Remove a model from the end of the collection.
  pop: function(options) {
    const model = this.at(this.length - 1);
    return this.remove(model, options);
  },

  // Add a model to the beginning of the collection.
  unshift: function(model, options) {
    return this.add(model, _.extend({at: 0}, options));
  },

  // Remove a model from the beginning of the collection.
  shift: function(options) {
    const model = this.at(0);
    return this.remove(model, options);
  },

  // Slice out a sub-array of models from the collection.
  slice: function() {
    return slice.apply(this.models, arguments);
  },

  filter: function(callback, thisArg) {
    return this.models.filter(
      _.isFunction(callback) ? callback : m => m.matches(callback),
      thisArg
    );
  },

  each: function(callback, thisArg) {
    return this.forEach(callback, thisArg);
  },

  forEach: function(callback, thisArg) {
    return this.models.forEach(callback, thisArg);
  },

  includes: function(callback, fromIndex) {
    return this.models.includes(callback, fromIndex);
  },

  map: function(cb, thisArg) {
    return this.models.map(
      _.isFunction(cb) ? cb : m => _.isString(cb) ? m.get(cb) : m.matches(cb),
      thisArg
    );
  },

  reduce: function(callback, initialValue) {
    return this.models.reduce(callback, initialValue || this.models[0]);
  },

  reduceRight: function(callback, initialValue) {
    return this.models.reduceRight(callback, initialValue || this.models[0]);
  },

  toArray: function () {
    return Array.from(this.models);
  },

  // Get a model from the set by id, cid, model object with id or cid
  // properties, or an attributes object that is transformed through modelId.
  get: function(obj) {
    if (obj == null) return undefined;
    return this._byId[obj] ||
      this._byId[this.modelId(this._isModel(obj) ? obj.attributes : obj)] ||
      obj.cid && this._byId[obj.cid];
  },

  // Returns `true` if the model is in the collection.
  has: function(obj) {
    return this.get(obj) != null;
  },

  // Get the model at the given index.
  at: function(index) {
    if (index < 0) index += this.length;
    return this.models[index];
  },

  // Return models with matching attributes. Useful for simple cases of
  // `filter`.
  where: function(attrs, first) {
    return this[first ? 'find' : 'filter'](attrs);
  },

  // Return the first model with matching attributes. Useful for simple cases
  // of `find`.
  findWhere: function(attrs) {
    return this.where(attrs, true);
  },

  // Force the collection to re-sort itself. You don't need to call this under
  // normal circumstances, as the set will maintain sort order as each item
  // is added.
  sort: function(options) {
    let comparator = this.comparator;
    if (!comparator) throw new Error('Cannot sort a set without a comparator');
    options || (options = {});

    const length = comparator.length;
    if (_.isFunction(comparator)) comparator = comparator.bind(this);

    // Run sort based on type of `comparator`.
    if (length === 1 || _.isString(comparator)) {
      this.models = this.sortBy(comparator);
    } else {
      this.models.sort(comparator);
    }
    if (!options.silent) this.trigger('sort', this, options);
    return this;
  },

  // Pluck an attribute from each model in the collection.
  pluck: function(attr) {
    return this.map(attr + '');
  },

  // Fetch the default set of models for this collection, resetting the
  // collection when they arrive. If `reset: true` is passed, the response
  // data will be passed through the `reset` method instead of `set`.
  fetch: function(options) {
    options = _.extend({parse: true}, options);
    const success = options.success;
    const collection = this;
    const promise = options.promise && getResolveablePromise();
    options.success = function(resp) {
      const method = options.reset ? 'reset' : 'set';
      collection[method](resp, options);
      if (success) success.call(options.context, collection, resp, options);
      promise && promise.resolve();
      collection.trigger('sync', collection, resp, options);
    };
    wrapError(this, options);
    return promise ? promise : this.sync('read', this, options);
  },

  // Create a new instance of a model in this collection. Add the model to the
  // collection immediately, unless `wait: true` is passed, in which case we
  // wait for the server to agree.
  create: function(model, options) {
    options = options ? _.clone(options) : {};
    const wait = options.wait;
    const return_promise = options.promise;
    const promise = return_promise && getResolveablePromise();

    model = this._prepareModel(model, options);
    if (!model) return false;
    if (!wait) this.add(model, options);
    const collection = this;
    const success = options.success;
    options.success = function(m, resp, callbackOpts) {
      if (wait) {
        collection.add(m, callbackOpts);
      }
      if (success) {
        success.call(callbackOpts.context, m, resp, callbackOpts);
      }
      if (return_promise) {
        promise.resolve(m);
      }
    };
    model.save(null, options);
    if (return_promise) {
      return promise;
    } else {
      return model;
    }
  },

  // **parse** converts a response into a list of models to be added to the
  // collection. The default implementation is just to pass it through.
  parse: function(resp, options) {
    return resp;
  },

  // Create a new collection with an identical list of models as this one.
  clone: function() {
    return new this.constructor(this.models, {
      model: this.model,
      comparator: this.comparator
    });
  },

  // Define how to uniquely identify models in the collection.
  modelId: function(attrs) {
    return attrs[this.model.prototype.idAttribute || 'id'];
  },

  // Get an iterator of all models in this collection.
  values: function() {
    return new CollectionIterator(this, ITERATOR_VALUES);
  },

  // Get an iterator of all model IDs in this collection.
  keys: function() {
    return new CollectionIterator(this, ITERATOR_KEYS);
  },

  // Get an iterator of all [ID, model] tuples in this collection.
  entries: function() {
    return new CollectionIterator(this, ITERATOR_KEYSVALUES);
  },

  // Private method to reset all internal state. Called when the collection
  // is first initialized or reset.
  _reset: function() {
    this.length = 0;
    this.models = [];
    this._byId  = {};
  },

  // Prepare a hash of attributes (or other model) to be added to this
  // collection.
  _prepareModel: function(attrs, options) {
    if (this._isModel(attrs)) {
      if (!attrs.collection) attrs.collection = this;
      return attrs;
    }
    options = options ? _.clone(options) : {};
    options.collection = this;
    const model = new this.model(attrs, options);
    if (!model.validationError) return model;
    this.trigger('invalid', this, model.validationError, options);
    return false;
  },

  // Internal method called by both remove and set.
  _removeModels: function(models, options) {
    const removed = [];
    for (let i = 0; i < models.length; i++) {
      const model = this.get(models[i]);
      if (!model) continue;

      const index = this.indexOf(model);
      this.models.splice(index, 1);
      this.length--;

      // Remove references before triggering 'remove' event to prevent an
      // infinite loop. #3693
      delete this._byId[model.cid];
      const id = this.modelId(model.attributes);
      if (id != null) delete this._byId[id];

      if (!options.silent) {
        options.index = index;
        model.trigger('remove', model, this, options);
      }

      removed.push(model);
      this._removeReference(model, options);
    }
    return removed;
  },

  // Method for checking whether an object should be considered a model for
  // the purposes of adding to the collection.
  _isModel: function(model) {
    return model instanceof Model;
  },

  // Internal method to create a model's ties to a collection.
  _addReference: function(model, options) {
    this._byId[model.cid] = model;
    const id = this.modelId(model.attributes);
    if (id != null) this._byId[id] = model;
    model.on('all', this._onModelEvent, this);
  },

  // Internal method to sever a model's ties to a collection.
  _removeReference: function(model, options) {
    delete this._byId[model.cid];
    const id = this.modelId(model.attributes);
    if (id != null) delete this._byId[id];
    if (this === model.collection) delete model.collection;
    model.off('all', this._onModelEvent, this);
  },

  // Internal method called every time a model in the set fires an event.
  // Sets need to update their indexes when models change ids. All other
  // events simply proxy through. "add" and "remove" events that originate
  // in other collections are ignored.
  _onModelEvent: function(event, model, collection, options) {
    if (model) {
      if ((event === 'add' || event === 'remove') && collection !== this) return;
      if (event === 'destroy') this.remove(model, options);
      if (event === 'change') {
        const prevId = this.modelId(model.previousAttributes());
        const id = this.modelId(model.attributes);
        if (prevId !== id) {
          if (prevId != null) delete this._byId[prevId];
          if (id != null) this._byId[id] = model;
        }
      }
    }
    this.trigger.apply(this, arguments);
  }

});

// Defining an @@iterator method implements JavaScript's Iterable protocol.
// In modern ES2015 browsers, this value is found at Symbol.iterator.
/* global Symbol */
const $$iterator = typeof Symbol === 'function' && Symbol.iterator;
if ($$iterator) {
  Collection.prototype[$$iterator] = Collection.prototype.values;
}

// CollectionIterator
// ------------------

// A CollectionIterator implements JavaScript's Iterator protocol, allowing the
// use of `for of` loops in modern browsers and interoperation between
// Collection and other JavaScript functions and third-party libraries
// which can operate on Iterables.
const CollectionIterator = function(collection, kind) {
  this._collection = collection;
  this._kind = kind;
  this._index = 0;
};

// This "enum" defines the three possible kinds of values which can be emitted
// by a CollectionIterator that correspond to the values(), keys() and entries()
// methods on Collection, respectively.
const ITERATOR_VALUES = 1;
const ITERATOR_KEYS = 2;
const ITERATOR_KEYSVALUES = 3;

// All Iterators should themselves be Iterable.
if ($$iterator) {
  CollectionIterator.prototype[$$iterator] = function() {
    return this;
  };
}

CollectionIterator.prototype.next = function() {
  if (this._collection) {

    // Only continue iterating if the iterated collection is long enough.
    if (this._index < this._collection.length) {
      const model = this._collection.at(this._index);
      this._index++;

      // Construct a value depending on what kind of values should be iterated.
      let value;
      if (this._kind === ITERATOR_VALUES) {
        value = model;
      } else {
        const id = this._collection.modelId(model.attributes);
        if (this._kind === ITERATOR_KEYS) {
          value = id;
        } else { // ITERATOR_KEYSVALUES
          value = [id, model];
        }
      }
      return {value: value, done: false};
    }

    // Once exhausted, remove the reference to the collection so future
    // calls to the next method always return done.
    this._collection = undefined;
  }

  return {value: undefined, done: true};
};

// Proxy Backbone class methods to Underscore functions, wrapping the model's
// `attributes` object or collection's `models` array behind the scenes.
//
// collection.filter(function(model) { return model.get('age') > 10 });
// collection.each(this.addView);
//
// `Function#apply` can be slow so we use the method's arg count, if we know it.
const addMethod = function(base, length, method, attribute) {
  switch (length) {
    case 1: return function() {
      return base[method](this[attribute]);
    };
    case 2: return function(value) {
      return base[method](this[attribute], value);
    };
    case 3: return function(iteratee, context) {
      return base[method](this[attribute], cb(iteratee, this), context);
    };
    case 4: return function(iteratee, defaultVal, context) {
      return base[method](this[attribute], cb(iteratee, this), defaultVal, context);
    };
    default: return function() {
      const args = slice.call(arguments);
      args.unshift(this[attribute]);
      return base[method].apply(base, args);
    };
  }
};

const addUnderscoreMethods = function(Class, base, methods, attribute) {
  _.each(methods, function(length, method) {
    if (base[method]) Class.prototype[method] = addMethod(base, length, method, attribute);
  });
};

// Support `collection.sortBy('attr')` and `collection.findWhere({id: 1})`.
const cb = function(iteratee, instance) {
  if (_.isFunction(iteratee)) return iteratee;
  if (_.isObject(iteratee) && !instance._isModel(iteratee)) return modelMatcher(iteratee);
  if (_.isString(iteratee)) return function(model) { return model.get(iteratee); };
  return iteratee;
};
const modelMatcher = function(attrs) {
  const matcher = _.matches(attrs);
  return function(model) {
    return matcher(model.attributes);
  };
};

// Underscore methods that we want to implement on the Collection.
// 90% of the core usefulness of Backbone Collections is actually implemented
// right here:
const collectionMethods = {
  all: 3,
  any: 3,
  chain: 1,
  collect: 3,
  contains: 3,
  countBy: 3,
  detect: 3,
  difference: 0,
  drop: 3,
  each: 3,
  every: 3,
  find: 3,
  findIndex: 3,
  findLastIndex: 3,
  first: 3,
  foldl: 0,
  foldr: 0,
  groupBy: 3,
  head: 3,
  include: 3,
  includes: 3,
  keyBy: 3,
  indexOf: 3,
  initial: 3,
  inject: 0,
  invokeMap: 0,
  isEmpty: 1,
  last: 3,
  lastIndexOf: 3,
  max: 3,
  min: 3,
  partition: 3,
  reject: 3,
  sample: 3,
  select: 3,
  shuffle: 1,
  size: 1,
  some: 3,
  sortBy: 3,
  tail: 3,
  take: 3,
  without: 0,
};


// Underscore methods that we want to implement on the Model, mapped to the
// number of arguments they take.
const modelMethods = {
  keys: 1,
  values: 1,
  pairs: 1,
  invert: 1,
  pick: 0,
  omit: 0,
  chain: 1,
  isEmpty: 1
};

// Mix in each Underscore method as a proxy to `Collection#models`.

[
  [Collection, collectionMethods, 'models'],
  [Model, modelMethods, 'attributes']
].forEach((config) => {
  const Base = config[0],
      methods = config[1],
      attribute = config[2];

  Base.mixin = function(obj) {
    const mappings = _.reduce(_.functions(obj), function(memo, name) {
      memo[name] = 0;
      return memo;
    }, {});
    addUnderscoreMethods(Base, obj, mappings, attribute);
  };

  addUnderscoreMethods(Base, _, methods, attribute);
});