let dictionary = [];

fetch('https://raw.githubusercontent.com/MeloDub/intesa-vincente-words/refs/heads/main/words.json')
    .then(response => response.json())
    .then(data => {
        data.forEach((word) => {
        for (let num = 0; num < word.p; num++) {
            dictionary.push(word);
        }
    });})
    .catch(error => console.error('Errore nel caricamento di words.json:', error));

let displayedWords = [];

function randomWord(w = 1) {
  const filteredDictionary = dictionary.filter((word) => word.w === w);

  let randomNum = Math.floor(Math.random() * filteredDictionary.length);
  let word = filteredDictionary[randomNum].word;

  while (displayedWords.includes(word)) {
    randomNum = Math.floor(Math.random() * filteredDictionary.length);
    word = filteredDictionary[randomNum].word;
  }

  return word;
}
