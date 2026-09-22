mergeInto(LibraryManager.library, {
  WebShare: function (titlePtr, urlPtr) {
    var title = UTF8ToString(titlePtr);
    var url = UTF8ToString(urlPtr);
    if (navigator.share) {
      navigator.share({ title: title, url: url }).catch(function () {});
    } else if (navigator.clipboard) {
      navigator.clipboard.writeText(url).catch(function () {});
    }
  }
});
