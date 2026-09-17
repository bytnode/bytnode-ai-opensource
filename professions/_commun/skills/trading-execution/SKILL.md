---
name: trading-execution
description: À ouvrir avant de passer, modifier ou annuler un ordre sur un compte exchange — la méthode en six pas (solde, prix, taille, ordre, confirmation, compte-rendu), la conversion quote → base, et ce qu'on ne fait jamais
---

# Passer un ordre proprement

Un ordre engage de l'argent, parfois réel. La méthode ci-dessous n'est pas une lourdeur : c'est ce qui évite l'ordre dix fois trop gros, la paire qui n'existe pas sur cet exchange, ou le second ordre passé parce que le premier « n'avait pas l'air » exécuté.

## Avant tout : quel compte, quel marché

- S'il y a plusieurs comptes, **nomme `account`** à chaque appel. Ne devine pas.
- Un compte **RÉEL** engage de l'argent réel ; un **testnet** non. Dis-le à l'utilisateur dans ta réponse, sans le lui faire deviner.
- `market: futures` pour un perpétuel ; sinon c'est le spot. Une position, un levier, un `reduceOnly` n'ont de sens qu'en futures.

## Les six pas

1. **Solde** — `ExchangeBalance` sur le compte et le marché visés. Combien de devise de cotation est libre ? En futures, la marge libre est ce qui compte.
2. **Prix** — `ExchangeTicker` sur la paire, **sur cet exchange** (BytNode donne le marché en général ; l'exchange donne le carnet qui va exécuter). Note `last`, `bid`, `ask`, et le spread.
3. **Taille** — l'ordre se passe en actif de **base** (`amount`, en BTC), pas en devise de cotation. Deux voies :
   - tu donnes `quoteAmount` (« 200 USDT ») et l'outil convertit au dernier prix ;
   - tu calcules `amount = montant_quote / prix` avec un calcul **exécuté** (compétence `calcul-verifie`), jamais de tête.
   L'outil arrondit à la précision du marché et refuse sous le minimum : lis son message.
4. **Ordre** — `PlaceOrder`. `market` pour exécuter maintenant ; `limit` avec `price` pour attendre un prix ; `stop` / `stop_limit` / `take_profit` avec `stopPrice` pour un déclenchement. En futures : `reduceOnly: true` pour tout ordre qui doit **sortir** d'une position, jamais pour y entrer.
   **L'utilisateur autorise chaque ordre.** Attends le résultat de l'outil ; un refus n'est pas une erreur à contourner, c'est une décision.
5. **Confirmation** — `ExchangeOrders` avec `status: "open"` (l'ordre attend) ou `"closed"` (il est passé : prix moyen, frais). Ne conclus jamais sur la seule réponse de `PlaceOrder` si elle dit `open` ou `pending`.
6. **Compte-rendu** — ce qui a été passé (paire, côté, quantité, type, prix), ce qui a été exécuté (moyen, frais), le solde ou la position après. Un chiffre = une lecture d'outil.

## Ce qu'on ne fait jamais

- Deux ordres sans avoir lu le résultat du premier.
- Un ordre « pour voir » sur un compte RÉEL.
- Convertir quote → base de tête.
- Supposer qu'un ordre `limit` est exécuté parce qu'il a été accepté.
- Insister après un refus de l'utilisateur.
- Chercher à retirer des fonds vers une adresse : l'outil n'existe pas, et il n'existera pas ; `Transfer` ne bouge que spot ↔ futures d'un même compte.

## Annuler, ajuster

- `CancelOrder` avec l'`orderId` lu dans `ExchangeOrders` ; `all: true` + `symbol` pour vider une paire.
- Pour déplacer un ordre limit : annule, puis repasse. Il n'y a pas de « modification ».
- `SetLeverage` **avant** l'ordre d'entrée, jamais sur une position ouverte sans l'avoir dit à l'utilisateur (la marge requise change).
