function nom() {
  $('.nom').toggleClass('nom-nom');
}
nom();
setInterval(nom, 5000);

$('#sudo').on('click', function() {
  document.cookie = 'sudo=' + (document.cookie.indexOf('sudo=true') < 0) + '; path=/';
  location.reload();
});
