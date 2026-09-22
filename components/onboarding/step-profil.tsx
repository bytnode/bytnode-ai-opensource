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
        Who are you?
      </h1>
      <p className="ob-lede">The agent will address you by your first name. Nothing leaves this computer.</p>

      <div className="ob-form">
        <div className="ob-row">
          <Field id="firstName" label="First name" error={errors.firstName}>
            <input
              id="firstName"
              className="field-input"
              autoComplete="given-name"
              autoFocus
              value={value.firstName}
              onChange={(e) => set({ firstName: e.target.value })}
            />
          </Field>
          <Field id="lastName" label="Last name" optional>
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
          label="A few words about you"
          optional
          hint="Your activity, your habits, what every agent should know about you. Passed on to all your agents."
        >
          <textarea
            id="bio"
            className="field-input"
            placeholder="Independent crypto trader, I mostly work on BTC and ETH…"
            value={value.bio}
            onChange={(e) => set({ bio: e.target.value })}
          />
        </Field>
      </div>
    </>
  );
}
