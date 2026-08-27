/**
 * VYUHA example — reversing a linked list, one frame per pointer move.
 *
 * Run it with:  VYUHA: Run and Visualize   (Ctrl+Alt+V)
 *
 * The helper is optional. This is the entire protocol:
 *     console.log('@vyuha ' + JSON.stringify({ list: values, active: [i] }));
 */

const v = require('./vyuha');

let values = [10, 20, 30, 40, 50];
v.linkedList(values, { title: 'reverse a linked list', note: 'original order' });

let reversed = [];
while (values.length) {
  const head = values.shift();
  reversed.unshift(head);
  v.linkedList(reversed.concat(values), {
    active: [0],
    title: 'reverse a linked list',
    note: `moved ${head} to the front`
  });
}

v.linkedList(reversed, { title: 'reverse a linked list', note: 'reversed' });
