/* Home versions, one per progression key, for the "Train at home" switch on the Log tab.
   Built for the equipment at home: a pair of 5 kg dumbbells, 6, 8 and 12 kg kettlebells, bodyweight, a chair. No bench.
   Squat and lunge patterns stay out, as in the gym plan.
   w is the list of weights owned for that move: when every set reaches the top of the rep range, the suggestion moves to
   the next one up, and at the heaviest it asks for slower lowering instead. fig is the two-frame animation in FIGIMG (used when it shows the same move without a machine, cable or bar), rid a still in ALTIMG. */
const KB=[6,8,12],DB=[5],BW=[0];
const HOME={
lat:{n:'Kettlebell floor pullover',eq:'kettlebell',kg:12,w:KB,u:'kg kettlebell',cue:'Lie on the floor with knees bent and hold the kettlebell by the horns over your chest. Lower it behind your head with soft elbows, then pull it back over your chest with your lats.'},
row:{n:'One-arm kettlebell row',eq:'kettlebell',kg:12,w:KB,u:'kg kettlebell, each arm',rid:'single-arm-db-row',cue:'One hand on a chair seat, flat back. Row the kettlebell to your hip and lower for 2 seconds. Do all reps on one side, then switch.'},
bbrow:{n:'Bent-over dumbbell row',eq:'dumbbell',kg:5,w:DB,u:'kg per hand',rid:'bent-over-db-row',cue:'Hinge to about 45 degrees with a flat back and row both dumbbells to your hips. Pause 1 second at the top and lower for 3 seconds.'},
rpd:{n:'Dumbbell reverse fly',eq:'dumbbell',kg:5,w:DB,u:'kg per hand',fig:'rear-delt-fly',rid:'dumbbell-reverse-fly',cue:'Hinge forward, raise the dumbbells out to the sides leading with your elbows, and lower slowly.'},
cc:{n:'Dumbbell curl',eq:'dumbbell',kg:5,w:DB,u:'kg per hand',fig:'bicep-curl',cue:'Standing, elbows pinned to your sides. Curl up, then lower for 3 seconds. No body swing.'},
dbc:{n:'One-arm kettlebell curl',eq:'kettlebell',kg:6,w:KB,u:'kg kettlebell, each arm',cue:'Hold the handle with the bell hanging behind your wrist, elbow by your side. Curl up, lower for 2 seconds. Do all reps on one side, then switch.'},
idb:{n:'Feet-up push-up',eq:'bodyweight',kg:0,w:BW,u:'bodyweight',cue:'Feet on a chair seat, hands a little wider than your shoulders. Lower your chest to the floor with elbows about 45 degrees from your body, then press up. This angle works the upper chest.'},
icp:{n:'One-arm kettlebell floor press',eq:'kettlebell',kg:12,w:KB,u:'kg kettlebell, each arm',cue:'Lie on the floor with knees bent. Lower the kettlebell until your upper arm touches the floor, pause, then press up. Do all reps on one side, then switch.'},
cf:{n:'Dumbbell floor fly',eq:'dumbbell',kg:5,w:DB,u:'kg per hand',cue:'Lie on the floor with a slight, fixed bend in the elbows. Open your arms until they touch the floor, then hug them back up over your chest.'},
lr:{n:'Dumbbell lateral raise',eq:'dumbbell',kg:5,w:DB,u:'kg per hand',fig:'lateral-raise',rid:'lateral-raise',cue:'Lead with the elbows, raise to shoulder height and lower for 3 seconds. Do not shrug.'},
clr:{n:'Leaning one-arm lateral raise',eq:'dumbbell',kg:5,w:DB,u:'kg, one dumbbell',fig:'lateral-raise',cue:'Hold a door frame and lean away from it. Raise the free arm to shoulder height, lower slowly. Do all reps on one side, then switch.'},
oh:{n:'One-arm overhead dumbbell extension',eq:'dumbbell',kg:5,w:DB,u:'kg, one dumbbell',rid:'single-arm-dumbbell-overhead-tricep-extension',cue:'Seated on a chair, elbow pointing up and close to your head. Lower the dumbbell behind your head for a deep stretch, then extend fully.'},
calf:{n:'One-leg calf raise',eq:'kettlebell',kg:8,w:KB,u:'kg kettlebell in one hand',rid:'dumbbell-calf-raise',cue:'Ball of one foot on a step, free hand on a wall. Full stretch at the bottom, pause 1 second at the top. Do all reps on one side, then switch.'},
add:{n:'Side-lying hip adduction',eq:'bodyweight',kg:0,w:BW,u:'bodyweight',rid:'side-lying-hip-adduction',cue:'Lie on your side, top foot planted in front. Lift the bottom leg, pause, lower slowly.'},
le:{n:'Seated leg extension',eq:'dumbbell',kg:5,w:DB,u:'kg, one dumbbell between the feet',cue:'Sit tall on a chair with a dumbbell held between your feet. Straighten your knees, squeeze 2 seconds at the top, lower for 3 seconds. Pain-free range only.'},
lp:{n:'Kettlebell step-up',eq:'kettlebell',kg:8,w:KB,u:'kg kettlebell held at the chest',rid:'step-ups',cue:'Low step or bottom stair. Drive through the whole front foot, stand tall, step down slowly. Do all reps on one leg, then switch. Stop on any knee pain.'},
hc:{n:'Towel slider leg curl',eq:'bodyweight',kg:0,w:BW,u:'bodyweight',cue:'Lie on your back on a smooth floor, heels on a towel. Lift your hips and pull your heels toward your glutes, then slide them out slowly.'},
rdl:{n:'One-leg kettlebell Romanian deadlift',eq:'kettlebell',kg:12,w:KB,u:'kg kettlebell',fig:'dumbbell-romanian-deadlift',rid:'single-leg-romanian-deadlift',cue:'Kettlebell in the hand opposite the standing leg. Push the hips back with a flat back until you feel the hamstring, then stand up. Do all reps on one side, then switch.'},
ht:{n:'One-leg glute bridge',eq:'bodyweight',kg:0,w:BW,u:'bodyweight',cue:'On your back, one foot planted, the other leg up. Drive through the heel, squeeze the glutes at the top for 1 second, ribs down. Do all reps on one side, then switch.'},
hammer:{n:'Dumbbell hammer curl',eq:'dumbbell',kg:5,w:DB,u:'kg per hand',fig:'hammer-curl',cue:'Palms face each other the whole way, elbows by your sides. Lower for 3 seconds.'},
pd:{n:'Seated kettlebell tricep extension',eq:'kettlebell',kg:12,w:KB,u:'kg kettlebell',rid:'seated-dumbbell-tricep-extension',cue:'Sit tall on a chair and hold the kettlebell by the horns behind your head. Keep the elbows pointing up and extend fully.'},
sp:{n:'One-arm kettlebell press',eq:'kettlebell',kg:8,w:KB,u:'kg kettlebell, each arm',rid:'one-arm-dumbbell-shoulder-press',cue:'Kettlebell resting on the back of your forearm at the shoulder. Press straight up without leaning or arching. Do all reps on one side, then switch.'},
rd:{n:'Dumbbell reverse fly',eq:'dumbbell',kg:5,w:DB,u:'kg per hand',fig:'rear-delt-fly',rid:'dumbbell-reverse-fly',cue:'Hinge forward with arms hanging. Raise out to the sides with slightly bent elbows and squeeze the back of the shoulders.'},
cr:{n:'Reverse crunch',eq:'bodyweight',kg:0,w:BW,u:'bodyweight',rid:'reverse-crunches',cue:'Lie on your back, knees bent. Curl your hips off the floor toward your ribs, lower slowly. No swinging.'},
mcp:{n:'Push-up',eq:'bodyweight',kg:0,w:BW,u:'bodyweight',cue:'Hands a little wider than your shoulders, body in a straight line. Lower your chest to the floor, press up without locking the elbows.'},
pec:{n:'Dumbbell floor fly',eq:'dumbbell',kg:5,w:DB,u:'kg per hand',cue:'Lie on the floor with a slight, fixed bend in the elbows. Open your arms until they touch the floor, then squeeze them back together over your chest.'},
sal:{n:'Kettlebell floor pullover',eq:'kettlebell',kg:12,w:KB,u:'kg kettlebell',cue:'Lie on the floor with knees bent and hold the kettlebell by the horns over your chest. Lower it behind your head with soft elbows, then pull it back with your lats.'},
tbar:{n:'Two-hand kettlebell row',eq:'kettlebell',kg:12,w:KB,u:'kg kettlebell',cue:'Hinge to about 45 degrees with a flat back, both hands on the handle. Row it to your lower chest and squeeze the shoulder blades. Lower for 3 seconds.'}
};
for(const k in HOME){HOME[k].id='home';HOME[k].st=0;HOME[k].home=1;}
/* every alternative for a lift: the gym ones, then the home version */
const altsFor=k=>(ALT[k]||[]).concat(HOME[k]?[HOME[k]]:[]);
