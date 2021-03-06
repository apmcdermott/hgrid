(function (global, factory) {
  if (typeof define === 'function' && define.amd) {  // AMD/RequireJS
    define(['jquery', 'hgrid'], factory);
  } else if (typeof module === 'object') {  // CommonJS/Node
    module.exports = factory(jQuery, HGrid);
  } else {  // No module system
    factory(jQuery, HGrid);
  }
}(this, function($, HGrid) {

/**
 * hgrid-draggable - Drag and drop support for HGrid
 */
this.Draggable = (function($, HGrid) {
  'use strict';

  /**
   * Default options for the Slick.RowMoveManager constructor
   * @type {Object}
   */
  var rowMoveManagerDefaults = {
    cancelEditOnDrag: true
  };

  /**
   * Default options for Draggable constructor
   * @type {Object}
   */
  var defaults = {
    /*jshint unused: false */

    onDrop: function(event, items, folder, insertBefore) {},
    onDrag: function(event, items, insertBefore) {},
    onBeforeDrag: function(event, items, insertBefore) {},
    onBeforeDrop: function(event, items, insertBefore) {},
    acceptDrop: function(item, folder, done) {},
    /**
     * Callback that is invoked if acceptDrop's done callback is called with
     * a string message, indicating that a drop has failed. By default, just
     * raises an HGrid.Error.
     */
    dropError: function(items, folder, message) {
      throw new HGrid.Error(message);
    },
    canDrag: function(item) {
      // disable dragging folder's for now
      if (item.kind === HGrid.FOLDER) {
        return false;
      }
      return true;
    },
    /**
     * Return false if folder should not be allowed as a drop target.
     * The folder will not be highlighted when being dragged over.
     * @param {Array[Object]} items The items being moved.
     * @param  {Object} folder The folder object
     */
    canAcceptDrop: function(items, folder) {},
    enableMove: true,

    // Additional options passed to the HGrid.RowMoveManager constructor
    rowMoveManagerOptions: {},
    // Additional options passed to the HGrid.RowSelectionModel constructor
    rowSelectionModelOptions: {}
  };

  /** Public interface **/

  /**
   * Constructor for the HGrid.Draggable plugin.
   *
   * NOTE: This should NOT invoke the `init` method because `init` will be invoked
   * when HGrid#registerPlugin is called.
   */
  function Draggable(options) {
    var self = this;
    self.grid = null;  // set upon calling Draggable.init
    self.options = $.extend({}, defaults, options);
    self.rowMoveManager = null;  // Initialized in init
    // The current drag target
    self._folderTarget = null;
  }

  Draggable.prototype.setTarget = function(folder) {
    this._folderTarget = folder;
  };


  Draggable.prototype.clearTarget = function() {
    this._folderTarget = null;
  };

  // Initialization function called by HGrid#registerPlugin
  Draggable.prototype.init = function(grid) {
    var self = this;
    self.grid = grid;
    var data = grid.getData();
    var dataView = grid.getDataView();
    var slickgrid = grid.grid;

    // Set selection model
    var rowSelectionModelOptions = self.options.rowSelectionModelOptions;
    slickgrid.setSelectionModel(new HGrid.RowSelectionModel(rowSelectionModelOptions));

    // Configure the RowMoveManager
    var rowMoveManagerOptions = $.extend(
      {}, rowMoveManagerDefaults, self.options.rowMoveManagerOptions
    );
    self.rowMoveManager = new HGrid.RowMoveManager(rowMoveManagerOptions);

    /** Callbacks **/

    var onBeforeDragRows = function(event, data) {
      var movedItems = data.items;
      var insertBefore = data.insertBefore;
      return self.options.onBeforeDrag.call(self, event, movedItems, insertBefore);
    };

    /**
     * Callback executed when rows are moved and dropped into a new location
     * on the grid.
     * @param  {Event} event
     * @param  {Object} args  Object containing information about the event,
     *                        including insertBefore.
     */
    var onMoveRows = function (event, args) {
      grid.removeHighlight();
      var extractedRows = [];
      // indices of the rows to move
      var indices = args.rows;
      var insertBefore = args.insertBefore;

      var movedItems = args.items;
      var i, item;

      // This function factory is to avoid creating function outside of loop context
      var makeErrorFunc = function(item, folder) {
        return function(message) {
          if (message) {
            return self.options.dropError.call(self, item, self._folderTarget, message);
          }
        };
      };

      for (i = 0, item = null; item = movedItems[i]; i++) {
        var errorFunc = makeErrorFunc(item, self._folderTarget);
        self.options.acceptDrop.call(self, item, self._folderTarget, errorFunc);
      }


      var beforeDrop = self.options.onBeforeDrop.call(self, event, movedItems, self._folderTarget, insertBefore);
      // If user-defined callback returns false, return early
      if (beforeDrop === false) {
        return false;
      }

      var newItems;
      // ID of the folder to transfer the items to
      if (self._folderTarget) {
        var parentID = self._folderTarget.id;
        // Copy the moved items, but change the parentID to the target folder's ID
        newItems = movedItems.map(function(item) {
          var newItem = $.extend({}, item);
          newItem.parentID = parentID;
          // remove depth and _node properties
          // these will be set upon adding the item to the grid
          delete newItem.depth;
          delete newItem._node;
          return newItem;
        });
      } else{
        newItems = [];
      }

      if (self.options.enableMove) {
        // Remove dragged items from grid
        for (i = 0, item = null; item = movedItems[i]; i++) {
          grid.removeItem(item.id);
        }
        // Add items at new location
        grid.addItems(newItems);

        slickgrid.resetActiveCell();
        slickgrid.setSelectedRows([]);
        slickgrid.render();
      }
      // invoke user-defined callback
      self.options.onDrop.call(self, event, movedItems, self._folderTarget, insertBefore);
    };

    var onDragStart = function(event, dd) {
      var cell = slickgrid.getCellFromEvent(event);
      if (!cell) {
        return;
      }

      dd.row = cell.row;
      if (!data[dd.row]) {
        return;
      }

      if (Slick.GlobalEditorLock.isActive()) {
        return;
      }

      event.stopImmediatePropagation();

      var selectedRows = slickgrid.getSelectedRows();

      if (!selectedRows.length || $.inArray(dd.row, selectedRows) === -1) {
        selectedRows = [dd.row];
        slickgrid.setSelectedRows(selectedRows);
      }

      dd.rows = selectedRows;
      dd.count = selectedRows.length;
    };


    /**
     * Given an index, return the correct parent folder to insert an item into.
     * @param  {Number} index
     * @return {Object}     Parent folder object or null
     */
    var getParent = function(index) {
      // First check if the dragged over item is an empty folder
      var prev = dataView.getItemByIdx(index - 1);
      var parent;
      if (prev.kind === HGrid.FOLDER) {
        parent = prev;
      } else{  // The item being dragged over is an item; get it's parent folder
        var nItems = dataView.getItems().length;
        var idx = index > nItems - 1 ? nItems - 1 : index;
        var insertItem = dataView.getItemByIdx(idx);
        parent = grid.getByID(insertItem.parentID);
      }
      return parent;
    };

    var onDragRows = function(event, args) {
      // set the current drag target
      var movedItems = args.items;
      var insertBefore = args.insertBefore;
      // get the parent of the current item being dragged over
      var parent;
      if (args.insertBefore) {
        parent = getParent(args.insertBefore);

        for (var i=0; i < movedItems.length; i++) {
          var node = movedItems[i]._node;
          // Can't drag folder into itself
          if (node.id === parent.id) {
            return false;
          }

          // Prevent dragging parent folders into descendant folder
          if (node.children) {
            for (var j=0; j < node.children.length; j++) {
              var child = node.children[j];
              if (parent.id === child.id) {
                self.clearTarget();
                grid.removeHighlight();
                return false;
              }
            }
          }
        }

        // Check if folder can accept drop
        // NOTE: canAccept must return false to disallow dropping, not just a falsy value
        if (self.options.canAcceptDrop.call(self, movedItems, parent) === false) {
          self.clearTarget();
          grid.removeHighlight();
          return false;
        }
        // set the folder target
        if (parent) {
          self.setTarget(parent);
          grid.addHighlight(self._folderTarget);
        }
      }
      self.options.onDrag.call(self, event, args.items, parent, insertBefore);
    };

    // TODO: test that this works
    var canDrag = function(item) {
      // invoke user-defined function
      return self.options.canDrag.call(self, item);
    };

    self.rowMoveManager.onBeforeDragRows.subscribe(onBeforeDragRows);
    self.rowMoveManager.onMoveRows.subscribe(onMoveRows);
    self.rowMoveManager.onDragRows.subscribe(onDragRows);
    self.rowMoveManager.canDrag = canDrag;

    // Register the slickgrid plugin
    slickgrid.registerPlugin(self.rowMoveManager);

    slickgrid.onDragInit.subscribe(function(event) {
      // prevent grid from cancelling drag'n'drop by default
      event.stopImmediatePropagation;
    });

    slickgrid.onDragStart.subscribe(onDragStart);
  };


  Draggable.prototype.destroy = function() {
    this.rowMoveManager.destroy();
    HGrid.Col.Name.behavior = null;
  };

  HGrid.Draggable = Draggable;
  return Draggable;
}).call(this, jQuery, HGrid);

/**
 * Customized row move manager, modified from slickgrid's rowmovemanger.js (MIT Licensed)
 * https://github.com/mleibman/SlickGrid/blob/master/plugins/slick.rowmovemanager.js
 */
(function ($, HGrid) {
  'use strict';
  function RowMoveManager(options) {
    var _grid;
    var _canvas;
    var _dragging;
    var _self = this;
    var _handler = new Slick.EventHandler();
    var _defaults = {
      cancelEditOnDrag: false,
      enableReorder: false, // TODO(sloria): reordering not implemented yet.
                            // Setting to false will disable the reorder guide.
      proxyClass: 'slick-reorder-proxy',
      guideClass: 'slick-reorder-guide'
    };

    function init(grid) {
      options = $.extend(true, {}, _defaults, options);
      _grid = grid;
      _canvas = _grid.getCanvasNode();
      _handler
        .subscribe(_grid.onDragInit, handleDragInit)
        .subscribe(_grid.onDragStart, handleDragStart)
        .subscribe(_grid.onDrag, handleDrag)
        .subscribe(_grid.onDragEnd, handleDragEnd);
    }

    function destroy() {
      _handler.unsubscribeAll();
    }

    function handleDragInit(e) {
      // prevent the grid from cancelling drag'n'drop by default
      e.stopImmediatePropagation();
    }

    function handleDragStart(e, dd) {
      var cell = _grid.getCellFromEvent(e);

      if (options.cancelEditOnDrag && _grid.getEditorLock().isActive()) {
        _grid.getEditorLock().cancelCurrentEdit();
      }

      if (_grid.getEditorLock().isActive() || !/move|selectAndMove/.test(_grid.getColumns()[cell.cell].behavior)) {
        return false;
      }

      _dragging = true;
      e.stopImmediatePropagation();

      var selectedRows = _grid.getSelectedRows();

      if (selectedRows.length === 0 || $.inArray(cell.row, selectedRows) === -1) {
        selectedRows = [cell.row];
        _grid.setSelectedRows(selectedRows);
      }

      var rowHeight = _grid.getOptions().rowHeight;

      dd.selectedRows = selectedRows;

      var movedItems = dd.selectedRows.map(function(rowIdx) {
        return _grid.getData().getItemByIdx(rowIdx);
      });

      for (var i = 0, item; item = movedItems[i]; i++) {
        if (_self.canDrag(item) === false) {
          return false;
        }
      }

      dd.selectionProxy = $('<div class="' + options.proxyClass + '"/>')
          .css('position', 'absolute')
          .css('zIndex', '99999')
          .css('width', $(_canvas).innerWidth())
          .css('height', rowHeight * selectedRows.length)
          .appendTo(_canvas);

      if (options.enableReorder) {
        dd.guide = $('<div class="' + options.guideClass + '"/>')
            .css('position', 'absolute')
            .css('zIndex', '99998')
            .css('width', $(_canvas).innerWidth())
            .css('top', -1000)
            .appendTo(_canvas);
      }

      dd.insertBefore = -1;

      _self.onDragRowsStart.notify({
        rows: dd.selectedRows,
        items: movedItems
      });
    }

    var cancelDrag = function() {
      _dragging = false;
    };

    function handleDrag(e, dd) {
      if (!_dragging) {
        return;
      }

      e.stopImmediatePropagation();

      var top = e.pageY - $(_canvas).offset().top;
      dd.selectionProxy.css('top', top - 5);

      var insertBefore = Math.max(0, Math.min(Math.round(top / _grid.getOptions().rowHeight), _grid.getDataLength()));

      // The moved data items
      var movedItems = dd.selectedRows.map(function(rowIdx) {
        return _grid.getData().getItemByIdx(rowIdx);
      });
      dd.movedItems = movedItems;

      if (insertBefore !== dd.insertBefore) {
        var eventData = {
          rows: dd.selectedRows,
          insertBefore: insertBefore,
          items: dd.movedItems
        };

        if (_self.onBeforeDragRows.notify(eventData) === false) {
          if (options.enableReorder) {
            dd.guide.css('top', -1000);
          }
          dd.canMove = false;
        } else {
          if (options.enableReorder) {
            dd.guide.css('top', insertBefore * _grid.getOptions().rowHeight);
          }
          dd.canMove = true;
        }

        dd.insertBefore = insertBefore;
      }

      _self.onDragRows.notify({
        rows: dd.selectedRows,
        insertBefore: dd.insertBefore,
        items: movedItems
      });
    }

    function handleDragEnd(e, dd) {
      e.stopImmediatePropagation();
      dd.selectionProxy.remove();
      if (!_dragging) {
        dd.selectionProxy.remove();
        return;
      }
      _dragging = false;

      if (options.enableReorder) {
        dd.guide.remove();
      }

      if (dd.canMove) {
        var eventData = {
          'rows': dd.selectedRows,
          'items': dd.movedItems,
          'insertBefore': dd.insertBefore
        };
        // TODO:  _grid.remapCellCssClasses ?
        _self.onMoveRows.notify(eventData);
      }
    }

    $.extend(this, {
      'onDragRowsStart': new Slick.Event(),
      'onBeforeDragRows': new Slick.Event(),
      'onMoveRows': new Slick.Event(),
      'onDragRows': new Slick.Event(),
      /*jshint unused:false */
      'canDrag': function(item) { return true; },
      'init': init,
      'destroy': destroy,
      'cancelDrag': cancelDrag
    });
  }

  HGrid.RowMoveManager = RowMoveManager;
})(jQuery, HGrid);

/**
 * Customized row selection model, modified from slickgrid's rowselectionmodel.js (MIT Licensed)
 * https://github.com/mleibman/SlickGrid/blob/master/plugins/slick.rowselectionmodel.js
 */
(function ($, HGrid) {
    'use strict';
    function RowSelectionModel(options) {
      var _grid;
      var _ranges = [];
      var _self = this;
      var _handler = new Slick.EventHandler();
      var _inHandler;
      var _options;
      var _defaults = {
        selectActiveRow: true
      };

      function init(grid) {
        _options = $.extend(true, {}, _defaults, options);
        _grid = grid;
        _handler.subscribe(_grid.onActiveCellChanged,
          wrapHandler(handleActiveCellChange));
        _handler.subscribe(_grid.onKeyDown,
          wrapHandler(handleKeyDown));
        _handler.subscribe(_grid.onClick,
          wrapHandler(handleClick));
      }

      function destroy() {
        _handler.unsubscribeAll();
      }

      function wrapHandler(handler) {
        return function () {
          if (!_inHandler) {
            _inHandler = true;
            handler.apply(this, arguments);
            _inHandler = false;
          }
        };
      }

      function rangesToRows(ranges) {
        var rows = [];
        for (var i = 0; i < ranges.length; i++) {
          for (var j = ranges[i].fromRow; j <= ranges[i].toRow; j++) {
            rows.push(j);
          }
        }
        return rows;
      }

      function rowsToRanges(rows) {
        var ranges = [];
        var lastCell = _grid.getColumns().length - 1;
        for (var i = 0; i < rows.length; i++) {
          ranges.push(new Slick.Range(rows[i], 0, rows[i], lastCell));
        }
        return ranges;
      }

      function getRowsRange(from, to) {
        var i, rows = [];
        for (i = from; i <= to; i++) {
          rows.push(i);
        }
        for (i = to; i < from; i++) {
          rows.push(i);
        }
        return rows;
      }

      function getSelectedRows() {
        return rangesToRows(_ranges);
      }

      function filterRowsNotInParent(rows) {
        var i, newRows = [];
        var originalRowIndex = rows[rows.length - 1];
        var gridData = _grid.getData();
        var originalRow = gridData.getItem(originalRowIndex);
        if (typeof originalRow !== 'undefined') {
          var originalParent = originalRow.parentID;
          for (i = 0; i < rows.length; i++) {
            var currentItem = gridData.getItem(rows[i]);
            if(currentItem.parentID === originalParent){
              newRows.push(rows[i]);
            }
          }
        }
        return newRows;
      }

      function setSelectedRows(rows) {
        setSelectedRanges(rowsToRanges(filterRowsNotInParent(rows)));
      }

      function setSelectedRanges(ranges) {
        _ranges = ranges;
        _self.onSelectedRangesChanged.notify(_ranges);
      }

      function getSelectedRanges() {
        return _ranges;
      }

      function handleActiveCellChange(e, data) {
        if (_options.selectActiveRow && data.row != null) {
          setSelectedRanges([new Slick.Range(data.row, 0, data.row, _grid.getColumns().length - 1)]);
        }
      }

      function handleKeyDown(e) {
        var activeRow = _grid.getActiveCell();
        if (activeRow && e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey &&
           (e.which === 38 || e.which === 40)) {
          var selectedRows = getSelectedRows();
          selectedRows.sort(function (x, y) {
            return x - y;
          });

          if (!selectedRows.length) {
            selectedRows = [activeRow.row];
          }

          var top = selectedRows[0];
          var bottom = selectedRows[selectedRows.length - 1];
          var active;

          if (e.which === 40) {
            active = activeRow.row < bottom || top === bottom ? ++bottom : ++top;
          } else {
            active = activeRow.row < bottom ? --bottom : --top;
          }

          if (active >= 0 && active < _grid.getDataLength()) {
            _grid.scrollRowIntoView(active);
            _ranges = rowsToRanges(getRowsRange(top, bottom));
            setSelectedRanges(_ranges);
          }

          e.preventDefault();
          e.stopPropagation();
        }
      }

      function handleClick(e) {
        var cell = _grid.getCellFromEvent(e);
        if (!cell || !_grid.canCellBeActive(cell.row, cell.cell)) {
          return false;
        }

        if (!_grid.getOptions().multiSelect || (
          !e.ctrlKey && !e.shiftKey && !e.metaKey)) {
          return false;
      }

      var selection = rangesToRows(_ranges);
      var idx = $.inArray(cell.row, selection);

      if (idx === -1 && (e.ctrlKey || e.metaKey)) {
        selection.push(cell.row);
        _grid.setActiveCell(cell.row, cell.cell);
      } else if (idx !== -1 && (e.ctrlKey || e.metaKey)) {
        selection = $.grep(selection, function (o) {
          return (o !== cell.row);
        });
        _grid.setActiveCell(cell.row, cell.cell);
      } else if (selection.length && e.shiftKey) {
        var last = selection.pop();
        var from = Math.min(cell.row, last);
        var to = Math.max(cell.row, last);
        selection = [];
        for (var i = from; i <= to; i++) {
          if (i !== last) {
            selection.push(i);
          }
        }
        selection.push(last);
        _grid.setActiveCell(cell.row, cell.cell);
      }

      _ranges = rowsToRanges(filterRowsNotInParent(selection));
      setSelectedRanges(_ranges);
      e.stopImmediatePropagation();

      return true;
    }

    $.extend(this, {
      'getSelectedRows': getSelectedRows,
      'setSelectedRows': setSelectedRows,

      'getSelectedRanges': getSelectedRanges,
      'setSelectedRanges': setSelectedRanges,

      'init': init,
      'destroy': destroy,

      'onSelectedRangesChanged': new Slick.Event()
    });
  }

  HGrid.RowSelectionModel = RowSelectionModel;
})(jQuery, HGrid);

    return Draggable;
}));
