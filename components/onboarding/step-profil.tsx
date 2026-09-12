import type { Profile } from "@/lib/domain/types";
import { Field } from "@/components/ui/field";
import type { StepErrors } from "./wizard";

type Props = {
  value: Profile;
  errors: StepErrors;
  onChange: (profile: Profile) => void;
};

export function StepProfil({ value, errors, onChange }: Props) {
  const set = (patch: Partial<Profile>) => onChange({ ...value, ...patch });
  return (
    <>
      <h1 id="ob-title" className="ob-title">
        Qui êtes-vous ?
      </h1>
      <p className="ob-lede">L&apos;agent s&apos;adressera à vous par votre prénom. Rien ne quitte cet ordinateur.</p>

      <div className="ob-form">
        <div className="ob-row">
          <Field id="firstName" label="Prénom" error={errors.firstName}>
            <input
              id="firstName"
              className="field-input"
              autoComplete="given-name"
              autoFocus
              value={value.firstName}
              onChange={(e) => set({ firstName: e.target.value })}
            />
          </Field>
          <Field id="lastName" label="Nom" optional>
            <input
              id="lastName"
              className="field-input"
              autoComplete="family-name"
              value={value.lastName}
              onChange={(e) => set({ lastName: e.target.value })}
            />
          </Field>
        </div>
        <Field id="email" label="Email" optional>
          <input
            id="email"
            className="field-input"
            type="email"
            autoComplete="email"
            value={value.email}
            onChange={(e) => set({ email: e.target.value })}
          />
        </Field>
        <Field
          id="bio"
          label="Quelques mots sur vous"
          optional
          hint="Votre activité, vos habitudes, ce que chaque agent doit savoir de vous. Transmis à tous vos agents."
        >
          <textarea
            id="bio"
            className="field-input"
            placeholder="Trader crypto indépendant, je travaille surtout sur BTC et ETH…"
            value={value.bio}
            onChange={(e) => set({ bio: e.target.value })}
          />
        </Field>
      </div>
    </>
  );
}
