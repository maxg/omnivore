function nom() {
  $('.nom').toggleClass('nom-nom');
}
nom();
setInterval(nom, 5000);

$('input[type=file]').on('change', function() {
  $(this).siblings('.btn-file-label').text('Selected: ' + this.value.split(/[\/\\]/).pop());
});
