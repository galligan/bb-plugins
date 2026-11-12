import { waitFor, type RenderResult } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

export async function chooseMachine(slot: Pick<RenderResult, "findByRole">) {
  const trigger = await slot.findByRole("combobox", { name: "Machine" });
  await waitFor(() => {
    if (trigger.hasAttribute("disabled"))
      throw new Error("Machines still loading");
  });
  await userEvent.click(trigger);
  await userEvent.click(
    await slot.findByRole("option", { name: "Fixture machine" }),
  );
}
