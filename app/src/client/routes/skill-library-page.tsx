import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useSkills, type SkillStatus } from "../hooks/use-skills";
import { SkillCard } from "../components/skill/skill-card";
import { Button } from "../components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../components/ui/tabs";

type StatusTab = "all" | SkillStatus;

const STATUS_TABS: { id: StatusTab; label: string }[] = [
  { id: "all", label: "All" },
  { id: "active", label: "Active" },
  { id: "draft", label: "Draft" },
  { id: "deprecated", label: "Deprecated" },
];

function filterByTab(statusTab: StatusTab): SkillStatus | undefined {
  return statusTab === "all" ? undefined : statusTab;
}

export function SkillLibraryPage() {
  const [activeTab, setActiveTab] = useState<StatusTab>("all");
  const statusFilter = filterByTab(activeTab);
  const { skills, isLoading, error } = useSkills(statusFilter);
  const navigate = useNavigate();

  if (error) {
    return (
      <section className="mx-auto flex max-w-4xl flex-col gap-4 p-6">
        <p className="text-sm text-destructive">Failed to load skills: {error}</p>
      </section>
    );
  }

  return (
    <section className="mx-auto flex max-w-4xl flex-col gap-4 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Skills</h1>
        <Button size="sm" onClick={() => void navigate({ to: "/skills/new" })}>
          Create Skill
        </Button>
      </div>

      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as StatusTab)}>
        <TabsList variant="line">
          {STATUS_TABS.map((tab) => (
            <TabsTrigger key={tab.id} value={tab.id}>
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>

        {STATUS_TABS.map((tab) => (
          <TabsContent key={tab.id} value={tab.id}>
            {isLoading ? (
              <p className="py-4 text-sm text-muted-foreground">Loading skills...</p>
            ) : skills.length === 0 ? (
              <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border p-8 text-center">
                <p className="text-sm text-muted-foreground">
                  {activeTab === "all"
                    ? "No skills yet. Skills define reusable capabilities that agents can learn."
                    : `No ${activeTab} skills found.`}
                </p>
                {activeTab === "all" ? (
                  <Button size="sm" onClick={() => void navigate({ to: "/skills/new" })}>
                    Create Skill
                  </Button>
                ) : undefined}
              </div>
            ) : (
              <div className="flex flex-col gap-2 py-2">
                {skills.map((skill) => (
                  <SkillCard key={skill.id} skill={skill} />
                ))}
              </div>
            )}
          </TabsContent>
        ))}
      </Tabs>
    </section>
  );
}
