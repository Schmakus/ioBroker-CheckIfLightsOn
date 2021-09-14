//------------------------------------------//
//    Beschreibung                          //
//------------------------------------------//

// Script um plötzlich von selbst eingeschaltete Leuchten über den deconz Adapter auszuschalten.
// Ebenfalls werden Leuchten "zwangsausgeschaltet", sollten diese beim ersten Schaltbefehlt nicht ausgehen
//
// Kleiner Nachteil: Lampen können nicht mehr separat geschaltet werden. Eine einzelne Lampe muss demnach in einer Gruppe organisiert sein


//  1) Datenpunkt any_on wechselt auf true und DP wird in einer Liste gespeichert, falls mehrere any_on-DPs auslösen (Lampe in mehreren Gruppen)
//  2) Vergleich aller in der Liste befindlichen DPs mit den in der jeweiligen Gruppe vorhandenen all_on-DPs
//  3) Falls kein all_on-DP ebenfalls auf true befindet, wird die gesamte Gruppe ausgeschaltet.
//  4) Die Gruppe 65520 (Alle Lampen) wird ignoriert
//  5) Datenpunkt all_on wechselt auf false => Es wird geprüft, ob any_on auf true verbleibt. Wenn ja, wird die Gruppe nochmals ausgeschalten


//------------------------------------------//
//    Changelog                             //
//------------------------------------------//
/*
v0.0.1
2021-09-14  * Init
*/


const version = `v 0.0.1`
const scriptname = `ioBroker-CheckIfLightsOn`
const constri = `Schmakus`

const triggerAnyOn = $("state[state.id=deconz.*.any_on]")
const triggerAllOn = $("state[state.id=deconz.*.all_on]")

let failLamp = {
    fail: false,
    pathLevel: '',
    deviceName: '',
}
let listOfAnyOn = []

let waitForOtherAnyOn = null
let waitForOtherAllOn = null

let logging = true

//******* Logeintrag mit Scriptnamen, Version und Developer */
console.log(`${scriptname} ${version} ${constri}`);

/**
 * Konstruktor für zum erstellen der Liste mit ausgelösten Datenpunkte
 * @param {object}  obj - Objekt des ausgelösten Datenpunkts
 */
function Group(obj){ 
    this.groupNumber = function(){
        let n = obj.channelId.split(/\.(?=[^\.]+$)/)
        return n[1]
    }
    this.pathLevel = 'deconz.0.Groups.' + this.groupNumber() + '.level'
    this.idAllOn = 'deconz.0.Groups.' + this.groupNumber() + '.all_on'
    this.idAnyOn = 'deconz.0.Groups.' + this.groupNumber() + '.any_on'
    this.deviceName = obj.channelName
}

/**
 * Neuen Datenpunk AnyOn der Liste hinzufügen
 * @param {object}  obj - Objekt des ausgelösten Datenpunkts
 */
async function addAnyOn(obj){    
    var a = new Group(obj)
    listOfAnyOn.push(a)
}
/**
 * Neuen Datenpunk AllOn der Liste hinzufügen
 * @param {object}  obj - Objekt des ausgelösten Datenpunkts
 */
async function addAllOn(obj){    
    var all = new Group(obj)
    return all
}

/**
Trigger auf einen beliebigen "any_on" Datenpunkt einer Gruppe des Deconz Adapters
*/
on({id: Array.prototype.slice.apply(triggerAnyOn), val: true, ack: true}, async function (obj) {
    (function () {if (waitForOtherAnyOn) {clearTimeout(waitForOtherAnyOn); waitForOtherAnyOn = null;}})();
    if(logging) console.log(`Trigger any_on hat ausgelöst: ${obj.channelName}`)
    await addAnyOn(obj)
    await anyOnCheck()
})

/**
Trigger auf einen beliebigen "all_on" Datenpunkt einer Gruppe des Deconz Adapters
*/ 
on({id: Array.prototype.slice.apply(triggerAllOn), change: 'ne', ack: true}, async function (obj) {
    (function () {if (waitForOtherAllOn) {clearTimeout(waitForOtherAllOn); waitForOtherAllOn = null;}})();

    if(logging) console.log(`Trigger all_on hat ausgelöst: ${obj.channelName}`)

    if(!obj.state.val) {        
        let allOn = await addAllOn(obj)
        if (logging) console.log(allOn)
        
        waitForOtherAllOn = setTimeout(function () {
            if(getState(allOn.idAnyOn).val) {
                setStateAsync(allOn.pathLevel, 0)
                sendTo("telegram", "send", {
                    text: `Eine Lampe musste ausgeschaltet werden, weil die nicht mit der Gruppe zusammen ausgeschaltet wurde. Gruppe: ${allOn.deviceName}`
                });
                if(logging) console.warn(`Eine Lampe musste ausgeschaltet werden, weil die nicht mit der Gruppe zusammen ausgeschaltet wurde. Gruppe: ${allOn.deviceName}`)
            }
        }, 5000)
    }
})

/**
 * Liste aller DPs erstellen und Vergleichen Datenpunkts
 */
async function anyOnCheck() {
    waitForOtherAnyOn = setTimeout(function () {
        if (logging) console.log(listOfAnyOn)

        // Schleife durch die Liste
        for (const i in listOfAnyOn) {
            let current = listOfAnyOn[i]
            //Schleife überspringen, wenn Gruppennummer >65000 ist (Alle Lampen)
            if (current.groupNumber() == 65520) {
                continue
            }
            // Prüfen, ob gesamte Gruppe eingeschaltet ist
            if (getState(current.idAnyOn).val == getState(current.idAllOn).val) {
                failLamp.fail = false
                break;
            } else {
                failLamp.fail = true
                failLamp.pathLevel = current.pathLevel
                failLamp.deviceName = current.deviceName                
            }
        }

        // Wenn eine einzelne Leuchte an ist, dann Level auf 0%
        if (failLamp.fail) {
            setStateAsync(failLamp.pathLevel, 0)
            sendTo("telegram", "send", {
                text: `Eine Lampe musste ausgeschaltet werden. Gruppe: ${failLamp.deviceName}`
            });
            if(logging) console.warn(`Eine Lampe musste ausgeschaltet werden: ${failLamp.deviceName}`)

        } else {
            if(logging) console.log(`Keine Fehlerhafte Lampe!`)
        }
        //Variablen zurücksetzen
        failLamp.fail = false
        failLamp.pathLevel = ''
        failLamp.deviceName = ''
        listOfAnyOn = []

    }, 1000)    
}


