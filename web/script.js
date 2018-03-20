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
