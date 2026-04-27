#!/usr/bin/env python3
"""One-off script: append data-i18n-es / -placeholder-es / -aria-es alongside
existing data-i18n-el (and variants) on the booking flow + experiences page.

The English default text in the HTML is left untouched, as is the existing
Greek (`-el`) value. Only ES additions are made.

Run from repo root:  python3 scripts/i18n_es_apply.py
"""
import os
import re
import sys

ES_MAP = {
    # —— provided + UI usage ——
    "Επιβάτης": "Pasajero",
    "Όχημα": "Vehículo",
    "Πληρωμή": "Pago",
    "Επικεφαλής επιβάτης": "Pasajero principal",
    "Όνομα": "Nombre",
    "Επώνυμο": "Apellidos",
    "Διεύθυνση email": "Correo electrónico",
    "Email": "Correo electrónico",
    "Τηλέφωνο": "Teléfono",
    "Κινητό τηλέφωνο": "Teléfono móvil",
    "Σημειώσεις για τον οδηγό": "Notas para el conductor",
    "Σημειώσεις για τον οδηγό (Μετάβαση)": "Notas para el conductor (Ida)",
    "Σημειώσεις": "Notas",
    "Ειδικά αιτήματα": "Peticiones especiales",
    "Συνέχεια στην πληρωμή": "Continuar al pago",
    "Συνέχεια": "Continuar",
    "Σύνολο": "Total",
    "Επιβεβαίωση κράτησης": "Confirmar reserva",
    "Η κράτησή σας επιβεβαιώθηκε!": "Tu reserva está confirmada",
    "Επιλεγμένες Εμπειρίες στην Ελλάδα": "Experiencias seleccionadas en Grecia",
    "Ζητήστε προσφορά": "Solicitar presupuesto",
    "Παραλαβή": "Recogida",
    "Σημείο παραλαβής": "Lugar de recogida",
    "Απλή διαδρομή": "Solo ida",
    "Επιστροφή": "Vuelta",

    # —— extension: remaining UI strings (formal "usted") ——
    "Ώρα παραλαβής": "Hora de recogida",
    "Ώρα": "Hora",
    "Ημερομηνία": "Fecha",
    "Ημερομηνία & ώρα": "Fecha y hora",
    "Ημερομηνία εμπειρίας": "Fecha de la experiencia",
    "Μετάβαση": "Ida",
    "Διάρκεια": "Duración",
    "Διαδρομή": "Ruta",
    "Επιβάτες": "Pasajeros",
    "επιβάτες": "pasajeros",
    "Συμμετέχοντες": "Participantes",
    "συμμετέχοντες": "participantes",
    "Αποσκευές": "Equipaje",
    "μικρές": "pequeñas",
    "μεγάλες": "grandes",
    "Επιστροφή στην αρχική": "Volver al inicio",
    "Πίσω": "Atrás",
    "Επεξεργασία": "Editar",
    "Αφαίρεση": "Quitar",
    "Δωρεάν ακύρωση": "Cancelación gratuita",
    "Υπηρεσία πόρτα-πόρτα": "Servicio puerta a puerta",
    "Υποδοχή με πινακίδα": "Recepción con cartel",
    "Υποδοχή με πινακίδα — εισαγάγετε το όνομα που θα εμφανιστεί.": "Recepción con cartel — introduzca el nombre que se mostrará.",
    "Παρακολούθηση πτήσης": "Seguimiento de vuelo",
    "Αδειούχοι οδηγοί": "Conductores con licencia",
    "Δεκτές:": "Aceptadas:",
    "Λεπτομέρειες τιμής": "Detalles del precio",
    "Αρχική τιμή": "Precio original",
    "Υποσύνολο:": "Subtotal:",
    "Χρέωση": "Cargo",
    "Η επιλογή σας": "Su elección",
    "Η επιλογή σας:": "Su elección:",
    "Η κράτησή σας": "Su reserva",
    "Αρ. αναφοράς": "N.º de referencia",
    "Email επιβεβαίωσης θα σταλεί στο": "Se enviará un correo electrónico de confirmación a",
    "Ολοκληρώστε την κράτησή σας": "Complete su reserva",
    "Επιλέξτε τρόπο πληρωμής": "Elija el método de pago",
    "Προπληρωμή (Online)": "Pago anticipado (en línea)",
    "Πληρώστε τώρα με πιστωτική/χρεωστική κάρτα": "Pague ahora con tarjeta de crédito/débito",
    "Μετρητά επί τόπου": "Efectivo en el lugar",
    "Πληρώστε τον οδηγό σε μετρητά κατά την άφιξη": "Pague al conductor en efectivo al llegar",
    "Κάρτα επί τόπου": "Tarjeta en el lugar",
    "Πληρώστε τον οδηγό με κάρτα κατά την άφιξη": "Pague al conductor con tarjeta al llegar",
    "Ισχύει χρέωση συναλλαγής 5%": "Se aplica un cargo por transacción del 5%",
    "Ασφαλές μέσω Stripe. Κρυπτογραφημένο από άκρο σε άκρο.": "Protegido por Stripe. Cifrado de extremo a extremo.",
    "Παρακαλούμε δώστε έναν αριθμό επικοινωνίας ώστε ο οδηγός μας να μπορεί να επικοινωνήσει με τον επιβάτη αν χρειαστεί.": "Indique un número de contacto para que nuestro conductor pueda comunicarse con el pasajero si es necesario.",
    "Θα σας στείλουμε εδώ το κουπόνι κράτησης.": "Le enviaremos aquí el bono de la reserva.",
    "Χρειάζεστε παιδικό κάθισμα ή μπούστερ;": "¿Necesita una silla infantil o elevador?",
    "Η μεταφορά σας κρατήθηκε με επιτυχία.": "Su traslado se ha reservado con éxito.",
    "Η ενοικίαση με την ώρα κρατήθηκε με επιτυχία.": "Su alquiler por horas se ha reservado con éxito.",
    "Η εκδρομή σας κρατήθηκε με επιτυχία.": "Su excursión se ha reservado con éxito.",
    "Ενοικίαση με την ώρα": "Alquiler por horas",
    "Εκδρομή": "Excursión",
    "Εμπειρία": "Experiencia",
    "Κράτηση μεταφοράς": "Reserva de traslado",
    "Κράτηση τουρ": "Reserva de excursión",
    "Προσθήκη επιστροφής": "Añadir vuelta",
    "ώρες": "horas",
    "Όλες οι τιμές περιλαμβάνουν ΦΠΑ, φόρους & διόδια": "Todos los precios incluyen IVA, impuestos y peajes",
    "Υπολογισμός διαδρομής": "Calculando la ruta",
    "Φόρτωση χάρτη...": "Cargando el mapa...",
    "Φόρτωση εμπειριών…": "Cargando experiencias…",
    "Δεν υπάρχουν διαθέσιμες εμπειρίες αυτή τη στιγμή.<br/>Δοκιμάστε ξανά σύντομα.": "No hay experiencias disponibles en este momento.<br/>Vuelva a intentarlo pronto.",
    "Αίτημα εμπειρίας": "Solicitud de experiencia",
    "Επιλέξτε μια εμπειρία...": "Seleccione una experiencia...",
    "Εξερευνήστε τις διαθέσιμες εμπειρίες": "Explore las experiencias disponibles",
    "Οι εμπειρίες μας": "Nuestras experiencias",
    "Επιλέξτε από την επιλεγμένη συλλογή ιδιωτικών εμπειριών μας, η καθεμία σχεδιασμένη να σας προσφέρει μια εξαιρετική γεύση της Ελλάδας.": "Elija entre nuestra colección seleccionada de experiencias privadas, cada una diseñada para ofrecerle una muestra excepcional de Grecia.",
    "Συμπληρώστε τα στοιχεία παρακάτω και θα σας απαντήσουμε με μια εξατομικευμένη προσφορά.": "Complete los datos a continuación y le responderemos con una oferta personalizada.",
    "Τα στοιχεία επικοινωνίας σας": "Sus datos de contacto",
    "Αριθμός εισιτηρίων": "Número de entradas",
    "(προαιρετικό)": "(opcional)",
    "Αποστολή αιτήματος": "Enviar solicitud",
    "Το αίτημα στάλθηκε!": "¡Solicitud enviada!",
    "Ευχαριστούμε για την επικοινωνία. Η ομάδα μας θα εξετάσει το αίτημα εμπειρίας σας και θα επικοινωνήσει σύντομα μαζί σας.": "Gracias por contactarnos. Nuestro equipo revisará su solicitud de experiencia y se pondrá en contacto con usted en breve.",
    "Θα λάβετε email επιβεβαίωσης στη διεύθυνση που δηλώσατε.": "Recibirá un correo electrónico de confirmación en la dirección indicada.",
    "Συμπερίληψη κράτησης ξενοδοχείου": "Incluir reserva de hotel",
    "Συμπερίληψη εισιτηρίων εισόδου": "Incluir entradas de admisión",
    "Εισιτήρια εισόδου": "Entradas de admisión",
    "Ξενοδοχείο για αυτή την πολυήμερη εκδρομή": "Hotel para esta excursión de varios días",
    "Δεν χρειάζεται ξενοδοχείο — θα κάνω δική μου κράτηση": "No necesito hotel — haré mi propia reserva",
    "Δεν χρειάζονται εισιτήρια": "No necesito entradas",
    "Φροντίζετε εσείς για τη διαμονή σας.": "Usted se encarga de su alojamiento.",
    "Θα φροντίσετε εσείς για τα εισιτήρια.": "Usted se encargará de las entradas.",
    "Θα προσθέσουμε τα εισιτήρια στο σύνολό σας και θα τα διευθετήσουμε εκ των προτέρων.": "Añadiremos las entradas a su total y nos encargaremos de ellas con antelación.",
    "Αυτή η εκδρομή περιλαμβάνει διανυκτέρευση(εις). Πείτε μας πώς θέλετε να διαχειριστείτε το ξενοδοχείο.": "Esta excursión incluye una o varias noches. Indíquenos cómo desea gestionar el hotel.",
    "Ένας από τους συνεργάτες μας θα επικοινωνήσει μαζί σας για να επιβεβαιώσει επιλογές ξενοδοχείου μετά την ολοκλήρωση.": "Uno de nuestros colaboradores se pondrá en contacto con usted para confirmar las opciones de hotel tras la finalización.",
    "στις": "a las",
    "ανά όχημα": "por vehículo",

    # —— interpolation strings (template literal preserved) ——
    "${hasReturn ? 'με επιστροφή' : 'τελική τιμή'}": "${hasReturn ? 'con vuelta' : 'precio final'}",
    "Έως ${v.maxPassengers}": "Hasta ${v.maxPassengers}",
    "Εφαρμόστηκε έκπτωση συνεργάτη: ${partnerDiscount}%": "Descuento de socio aplicado: ${partnerDiscount}%",
}

PLACEHOLDER_MAP = {
    "Γιάννης": "Juan",
    "Γιάννα": "Ana",
    "Παπαδόπουλος": "García",
    "Εισαγάγετε το όνομα που θα εμφανιστεί στην πινακίδα": "Introduzca el nombre que se mostrará en el cartel",
    "Ειδικά αιτήματα, διατροφικές ανάγκες, απαιτήσεις προσβασιμότητας... Χωρίς ευαίσθητα δεδομένα — προσθέστε τηλέφωνο στο επόμενο βήμα.": "Peticiones especiales, necesidades dietéticas, requisitos de accesibilidad... Sin datos sensibles — añada el teléfono en el siguiente paso.",
    "Ειδικά αιτήματα, διατροφικές ανάγκες, απαιτήσεις προσβασιμότητας...": "Peticiones especiales, necesidades dietéticas, requisitos de accesibilidad...",
    "Ειδικά αιτήματα, οδηγίες παραλαβής...": "Peticiones especiales, instrucciones de recogida...",
    "Κάτι που πρέπει να γνωρίζουμε; Διατροφικοί περιορισμοί, ανάγκες προσβασιμότητας κ.λπ.": "¿Algo que debamos saber? Restricciones dietéticas, necesidades de accesibilidad, etc.",
    "Ξενοδοχείο, διεύθυνση ή ορόσημο...": "Hotel, dirección o punto de referencia...",
}

ARIA_MAP = {
    "Επόμενο": "Siguiente",
    "Προηγούμενο": "Anterior",
    "Λιγότεροι συμμετέχοντες": "Menos participantes",
    "Περισσότεροι συμμετέχοντες": "Más participantes",
    "Επιλογή ξενοδοχείου": "Selección de hotel",
    "Επιλογή εισιτηρίων εισόδου": "Selección de entradas",
}

FILES = [
    "src/pages/book/transfer/passenger.astro",
    "src/pages/book/transfer/payment.astro",
    "src/pages/book/transfer/results.astro",
    "src/pages/book/hourly/passenger.astro",
    "src/pages/book/hourly/payment.astro",
    "src/pages/book/hourly/results.astro",
    "src/pages/book/tour/passenger.astro",
    "src/pages/book/tour/payment.astro",
    "src/pages/book/tour/results.astro",
    "src/pages/experiences.astro",
]

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def ensure(content, attr_el, attr_es, mapping):
    """Append attr_es="ES" right after each attr_el="VAL" in content,
    unless the same tag already carries an attr_es."""
    pattern = re.compile(r'(' + re.escape(attr_el) + r')="([^"]*)"')
    missing = []
    counter = [0]

    def repl(m):
        full = m.group(0)
        gr = m.group(2)
        end = m.end()
        gt = content.find('>', end)
        scope_end = gt if gt != -1 else end + 500
        tail = content[end:scope_end]
        if attr_es + '="' in tail:
            return full
        es = mapping.get(gr)
        if es is None:
            missing.append(gr)
            return full
        counter[0] += 1
        return full + ' ' + attr_es + '="' + es + '"'

    new_content = pattern.sub(repl, content)
    return new_content, counter[0], missing


def main():
    total = {"el": 0, "ph": 0, "aria": 0, "alt": 0}
    rows = []
    all_missing = {}

    for rel in FILES:
        p = os.path.join(ROOT, rel)
        with open(p, "r", encoding="utf-8") as f:
            content = f.read()

        content, n_el, miss_el = ensure(content, "data-i18n-el", "data-i18n-es", ES_MAP)
        content, n_ph, miss_ph = ensure(content, "data-i18n-placeholder-el", "data-i18n-placeholder-es", PLACEHOLDER_MAP)
        content, n_aria, miss_aria = ensure(content, "data-i18n-aria-el", "data-i18n-aria-es", ARIA_MAP)
        content, n_alt, miss_alt = ensure(content, "data-i18n-alt-el", "data-i18n-alt-es", {})

        with open(p, "w", encoding="utf-8") as f:
            f.write(content)

        total["el"] += n_el
        total["ph"] += n_ph
        total["aria"] += n_aria
        total["alt"] += n_alt
        rows.append((rel, n_el, n_ph, n_aria, n_alt))
        miss_all = miss_el + miss_ph + miss_aria + miss_alt
        if miss_all:
            all_missing[rel] = miss_all

    print("=== PER-FILE COUNTS ===")
    for rel, n_el, n_ph, n_aria, n_alt in rows:
        print(f"  {rel}: text={n_el} ph={n_ph} aria={n_aria} alt={n_alt}")
    print(f"=== TOTALS: text={total['el']} ph={total['ph']} aria={total['aria']} alt={total['alt']}")

    if all_missing:
        print("\n=== MISSING TRANSLATIONS ===")
        for rel, miss in all_missing.items():
            for m in miss:
                print(f"  {rel}: {m!r}")
        sys.exit(1)


if __name__ == "__main__":
    main()
