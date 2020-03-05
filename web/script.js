function nom() {
  $('.nom').toggleClass('nom-nom');
}
nom();
setInterval(nom, 5000);

$('input[type=file]').on('change', function() {
  $(this).siblings('.btn-file-label').text('Selected: ' + this.value.split(/[\/\\]/).pop());
  $(this).closest('form').find('.btn-upload').prop('disabled', false);
});
$('input[type=file]').on('dragenter', function(event) {
  $(this).parent().toggleClass('drag-drop-hover', true);
});
$('input[type=file]').on('dragleave drop', function(event) {
  $(this).parent().toggleClass('drag-drop-hover', false);
});
$('textarea.txt-upload').on('input', function() {
  $(this).closest('form').find('.btn-upload').prop('disabled', false);
});

function updateFromStream(elt, html) {
  let user = 'data-stream-user';
  for (let replacement of html.querySelectorAll('['+user+']')) {
    elt.querySelector('['+user+'='+replacement.getAttribute(user)+']').replaceWith(replacement);
    replacement.removeAttribute(user);
  }
};
$('table[data-stream]').each(function(_, table) {
  let decoder = new TextDecoder("utf-8");
  let range = document.createRange();
  range.selectNode(table.firstElementChild);
  fetch(table.getAttribute('data-stream')).then(function(res) {
    let partial = '';
    let reader = res.body.getReader();
    reader.read().then(function processStream(chunk) {
      if (chunk.done) { return; }
      let pieces = decoder.decode(chunk.value).split('\0');
      pieces[0] = partial + pieces[0];
      partial = pieces.pop();
      for (let piece of pieces) {
        updateFromStream(table, range.createContextualFragment(piece));
      }
      reader.read().then(processStream);
    });
  });
});
